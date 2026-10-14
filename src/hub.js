// -----------------------------------------------------------------------------
// The hub: the link to evcc (websocket, REST as a fallback) and everything
// Gladys sees of it — devices, states, connection status, scene events,
// commands.
//
// Flow: GET /api/state at start (and after every loss of the websocket), then
// the websocket /ws for the changes. While the websocket is down, the state
// is read by REST every `restInterval`, and the websocket keeps retrying.
// Messages are applied to the raw state at once; the states reach Gladys at
// most every `minFlushGap` (evcc sends one frame per changed key).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { EvccClient, EvccError, socketUrl } from './evcc/client.js';
import { MODES, applyMessage, snapshotOf } from './evcc/model.js';
import { PushLink } from './evcc/socket.js';
import {
  LIMIT_SOC,
  buildDevices,
  buildStates,
  loadpointIds,
  parseExternalId,
  siteIds,
  structureOf,
  vehicleIds,
  vehicleKey,
} from './devices.js';
import { SessionTracker, TRIGGERS } from './events.js';
import { ProblemLog } from './problems.js';
import { MODE_LABELS, STATUS_TEXT, TEST_TEXT, commandMessage } from './texts.js';

const logger = createLogger({ name: 'evcc-hub' });

export const WIDGET_KEY = 'evcc';

export const DEFAULT_TIMINGS = {
  // REST reads while the websocket is down (evcc's own cycle is 30 s).
  restInterval: 30_000,
  // Frames of one evcc cycle arrive together, one key each: the state is
  // read once the burst is over, so an event never sees half a cycle.
  processDelay: 250,
  processMaxWait: 2_000,
  flushDelay: 1_000,
  minFlushGap: 5_000,
  // Checks the end of charges (quiet period) and the vehicle identification.
  tickInterval: 30_000,
  // An unchanged value is published again after this long (Gladys shows
  // "no recent value" after 48 h).
  heartbeat: 6 * 3_600_000,
};

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;

// The energy limit of a loadpoint, in kWh (0 removes it).
export const LIMIT_ENERGY = { min: 0, max: 200 };

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language, ...args) {
    const message = commandMessage(code, ...args);
    super(message[language] ?? message.en);
    this.code = code;
    this.messages = message;
  }
}

export class Hub {
  constructor({ gladys, store, fetch, createSocket, timings, socketTimings, sessionTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.createSocket = createSocket;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.socketTimings = socketTimings;
    this.now = now ?? Date.now;
    this.config = { url: null, invalidUrl: false, password: '', language: 'fr' };
    this.client = null;
    this.link = null;
    this.raw = null;
    this.snapshot = null;
    this.known = {};
    this.structure = null;
    this.tracker = new SessionTracker(sessionTimings);
    // 'none' | 'invalid' | 'connecting' | 'online' | 'unreachable' | 'unauthorized' | 'invalidAnswer'
    this.status = 'none';
    this.lastStatus = '';
    this.lastRestAt = 0;
    this.restTimer = null;
    this.tickTimer = null;
    this.flushTimer = null;
    this.processTimer = null;
    this.lastFlushAt = 0;
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.generation = 0;
    this.stopped = false;
    this.problems = new ProblemLog(logger);
  }

  get language() {
    return this.config.language;
  }

  get live() {
    return Boolean(this.link?.live);
  }

  async start(config) {
    const saved = await this.store.load();
    this.known = saved && typeof saved.structure === 'object' ? saved.structure : {};
    // Known from a previous run: the devices stay listed while evcc is off.
    this.structure = this.known.site ? this.known : null;
    await this.publishDevices();
    this.tickTimer = setInterval(() => this.#tick(), this.timings.tickInterval);
    this.tickTimer.unref?.();
    await this.reconfigure(config);
  }

  /** New configuration: reconnect when the address or the password changed. */
  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const changed = config.url !== previous.url || config.password !== previous.password;
    if (changed || !this.client) {
      this.#disconnect();
      if (config.url) {
        this.#connect();
      } else {
        this.status = config.invalidUrl ? 'invalid' : 'none';
      }
    }
    if (config.language !== previous.language && this.structure) {
      await this.publishDevices();
      this.gladys.forgetPublishedStates?.();
      await this.flush();
    }
    if (changed && this.config.url) {
      await this.refreshRest();
    }
    await this.updateConnectionStatus();
    this.refreshWidget();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.lastStatus = '';
    await this.reconfigure(config);
    await this.publishDevices();
    await this.flush();
  }

  stop() {
    this.stopped = true;
    this.#disconnect();
    clearInterval(this.tickTimer);
    clearTimeout(this.widgetTimer);
    return this.store.flush();
  }

  #connect() {
    this.generation += 1;
    this.status = 'connecting';
    this.client = new EvccClient({
      baseUrl: this.config.url,
      password: this.config.password,
      fetch: this.fetch,
    });
    const link = new PushLink({
      url: socketUrl(this.config.url),
      createSocket: this.createSocket,
      timings: this.socketTimings,
    });
    this.link = link;
    link.on('open', () => this.#onLinkOpen(link));
    link.on('close', () => this.#onLinkClose(link));
    link.on('message', (message) => this.#onMessage(link, message));
    link.on('retry', ({ reason, delay }) =>
      logger.debug(`evcc websocket down (${reason}), retrying in ${delay} ms`),
    );
    link.start();
    this.#scheduleRest();
  }

  #disconnect() {
    this.generation += 1;
    // Detached before stop(): its `close` event must not start a read with
    // the old client (an emptied address would come back "online").
    const link = this.link;
    this.link = null;
    this.client = null;
    link?.removeAllListeners();
    link?.stop();
    this.raw = null;
    this.tracker.reset();
    clearTimeout(this.restTimer);
    clearTimeout(this.flushTimer);
    clearTimeout(this.processTimer);
    this.restTimer = null;
    this.flushTimer = null;
    this.processTimer = null;
  }

  // --- Reading evcc ---------------------------------------------------------

  #onLinkOpen(link) {
    if (link !== this.link) {
      return;
    }
    clearTimeout(this.restTimer);
    this.restTimer = null;
  }

  #onLinkClose(link) {
    if (link !== this.link || this.stopped) {
      return;
    }
    // Messages may have been lost: a full read, then REST until it is back.
    this.refreshRest().catch(() => {});
  }

  #onMessage(link, message) {
    if (link !== this.link) {
      return;
    }
    if (!this.raw) {
      this.raw = {};
    }
    applyMessage(this.raw, message);
    if (!Array.isArray(this.raw.loadpoints)) {
      // Not yet a full state (the first frame of evcc holds every key).
      return;
    }
    this.problems.recover('read', 'evcc answers again');
    this.#setStatus('online');
    // Debounced: re-armed by every frame, but never later than
    // processMaxWait after the first frame of the burst.
    const now = this.now();
    if (!this.processTimer) {
      this.burstStart = now;
    }
    clearTimeout(this.processTimer);
    const wait = Math.min(
      this.timings.processDelay,
      Math.max(0, this.burstStart + this.timings.processMaxWait - now),
    );
    this.processTimer = setTimeout(() => {
      this.processTimer = null;
      this.#process();
    }, wait);
    this.processTimer.unref?.();
  }

  #scheduleRest() {
    clearTimeout(this.restTimer);
    if (this.stopped || !this.client || this.live) {
      this.restTimer = null;
      return;
    }
    this.restTimer = setTimeout(() => {
      this.restTimer = null;
      this.refreshRest().catch(() => {});
    }, this.timings.restInterval);
    this.restTimer.unref?.();
  }

  /** A full read of /api/state (start, websocket lost, fallback, test). */
  async refreshRest() {
    const client = this.client;
    const generation = this.generation;
    if (!client) {
      return false;
    }
    try {
      const state = await client.getState();
      if (generation !== this.generation) {
        return false;
      }
      this.lastRestAt = this.now();
      // The websocket may already have delivered newer values: REST only
      // replaces the state while the websocket is down.
      if (!this.live || !this.raw) {
        this.raw = state;
      }
      this.problems.recover('read', 'evcc answers again');
      this.#setStatus('online');
      this.#process();
      return true;
    } catch (err) {
      if (generation !== this.generation) {
        return false;
      }
      const kind = err instanceof EvccError ? err.kind : 'unreachable';
      // One line per kind of outage: the detail (timeout, EHOSTUNREACH...)
      // may alternate between attempts, it stays at debug level.
      logger.debug(`Cannot read evcc: ${err.message}`);
      this.problems.fail('read', `Cannot read evcc at ${this.config.url} (${kind})`);
      if (!this.live) {
        this.tracker.reset();
        this.#setStatus(
          kind === 'unauthorized'
            ? 'unauthorized'
            : kind === 'invalid'
              ? 'invalidAnswer'
              : 'unreachable',
        );
      }
      return false;
    } finally {
      if (generation === this.generation) {
        this.#scheduleRest();
        await this.updateConnectionStatus();
      }
    }
  }

  #setStatus(status) {
    if (status === this.status) {
      return;
    }
    const before = this.status;
    this.status = status;
    if (status === 'online' && before !== 'online') {
      const version = typeof this.raw?.version === 'string' ? ` ${this.raw.version}` : '';
      logger.info(
        `Connected to evcc${version} (${this.raw?.loadpoints?.length ?? 0} loadpoint(s))`,
      );
    }
    this.updateConnectionStatus().catch(() => {});
    this.refreshWidget();
  }

  #process() {
    if (!this.raw || this.stopped) {
      return;
    }
    const snapshot = snapshotOf(this.raw);
    const previous = this.snapshot;
    this.snapshot = snapshot;
    const structure = structureOf(snapshot, this.structure ?? this.known);
    if (JSON.stringify(structure) !== JSON.stringify(this.structure)) {
      this.structure = structure;
      this.known = structure;
      this.store.save({ structure });
      this.publishDevices();
      this.refreshWidget();
    }
    this.#fire(this.tracker.update(snapshot, this.now()));
    if (previous && widgetChanged(previous, snapshot)) {
      this.refreshWidget();
    }
    this.#scheduleFlush();
  }

  #tick() {
    if (this.snapshot && this.status === 'online') {
      this.#fire(this.tracker.tick(this.snapshot, this.now()));
    }
  }

  // --- Devices and states -----------------------------------------------------

  async publishDevices() {
    if (!this.structure) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(
        buildDevices(this.gladys, this.structure, this.language),
      );
    } catch (err) {
      logger.error('Cannot publish the devices', err);
    }
  }

  #scheduleFlush() {
    if (this.flushTimer || this.stopped) {
      return;
    }
    const wait = Math.max(
      this.timings.flushDelay,
      this.lastFlushAt + this.timings.minFlushGap - this.now(),
    );
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, wait);
    this.flushTimer.unref?.();
  }

  /** Publish the changed states now. */
  async flush() {
    if (!this.snapshot || !this.structure || this.stopped) {
      return;
    }
    this.lastFlushAt = this.now();
    const states = buildStates(this.gladys, this.snapshot, this.structure, this.language);
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeat });
    } catch (err) {
      this.problems.fail('states', `Cannot publish the states: ${err.message}`);
      return;
    }
    this.problems.recover('states', 'States published again');
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (typeof device?.external_id === 'string') {
      this.gladys.forgetPublishedStates?.(device.external_id);
    }
    await this.flush();
    this.refreshWidget();
  }

  // --- Scene events ---------------------------------------------------------

  /** Name of a device as the user sees it in Gladys (renamed or not). */
  deviceName(externalId, fallback) {
    const created = (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
    return created?.name ?? fallback;
  }

  #fire(events) {
    for (const event of events) {
      const lp = event.loadpoint;
      const device = loadpointIds(this.gladys, lp.id).device;
      const vehicleDevice = lp.vehicleName ? vehicleIds(this.gladys, lp.vehicleName).device : '';
      const data = {
        device,
        loadpoint: this.deviceName(device, lp.title),
      };
      if (event.type !== 'mode') {
        data.vehicle_device = vehicleDevice;
        // evcc sends the vehicle name and its title in two frames: the
        // structure knows the title of every vehicle.
        const title =
          lp.vehicleTitle ??
          this.structure?.vehicles.find((v) => v.name === lp.vehicleName)?.title ??
          '';
        data.vehicle = vehicleDevice ? this.deviceName(vehicleDevice, title) : '';
      }
      const energy = lp.sessionEnergy === null ? 0 : Math.round(lp.sessionEnergy / 10) / 100;
      switch (event.type) {
        case 'started':
          data.mode = lp.mode ?? '';
          break;
        case 'finished':
          data.energy_kwh = energy;
          data.duration_minutes = Math.round((lp.chargeDuration ?? 0) / 60);
          data.solar_percent = Math.round(lp.sessionSolarPercentage ?? 0);
          break;
        case 'disconnected':
          data.energy_kwh = energy;
          data.duration_minutes = Math.round((lp.connectedDuration ?? 0) / 60);
          break;
        case 'mode':
          data.mode = lp.mode;
          data.previous_mode = event.previousMode;
          data.mode_label = (MODE_LABELS[this.language] ?? MODE_LABELS.en)[lp.mode];
          break;
        default:
          break;
      }
      const key = TRIGGERS[event.type];
      logger.info(`${lp.title}: ${key}${data.vehicle ? ` (${data.vehicle})` : ''}`);
      this.gladys
        .publishSceneEvent(key, data)
        .catch((err) => logger.warn(`Cannot fire ${key}: ${err.message}`));
      this.refreshWidget();
    }
  }

  // --- Widget ---------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- Connection status ----------------------------------------------------

  async updateConnectionStatus() {
    if (this.stopped || this.status === 'connecting') {
      return;
    }
    const connected = this.status === 'online';
    const key = connected ? null : this.status;
    const message = key
      ? Object.fromEntries(
          Object.entries(STATUS_TEXT).map(([language, table]) => [language, table[key]]),
        )
      : undefined;
    const fingerprint = JSON.stringify({ connected, key });
    if (fingerprint === this.lastStatus) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.problems.fail('status', `Cannot set the connection status: ${err.message}`);
      this.lastStatus = '';
      return;
    }
    this.problems.recover('status', 'Connection status set again');
  }

  // --- Commands -----------------------------------------------------------

  #target(externalId) {
    const parsed = parseExternalId(this.gladys, externalId);
    if (!parsed || !this.structure) {
      throw new CommandError('unknown_device', this.language);
    }
    if (parsed.kind === 'loadpoint') {
      const loadpoint = this.structure.loadpoints.find((lp) => String(lp.id) === parsed.id);
      if (loadpoint) {
        return { kind: 'loadpoint', loadpoint, feature: parsed.feature };
      }
    }
    if (parsed.kind === 'vehicle') {
      const vehicle = this.structure.vehicles.find((v) => vehicleKey(v.name) === parsed.id);
      if (vehicle) {
        return { kind: 'vehicle', vehicle, feature: parsed.feature };
      }
    }
    if (parsed.kind === 'site') {
      return { kind: 'site' };
    }
    throw new CommandError('unknown_device', this.language);
  }

  async #send(run, what) {
    if (!this.client) {
      throw new CommandError('unreachable', this.language);
    }
    try {
      await run(this.client);
    } catch (err) {
      if (err instanceof EvccError) {
        logger.warn(`${what}: ${err.message}`);
        throw new CommandError(
          err.kind === 'unauthorized'
            ? 'unauthorized'
            : err.kind === 'unreachable'
              ? 'unreachable'
              : 'refused',
          this.language,
        );
      }
      throw err;
    }
    logger.info(what);
    if (!this.live) {
      // No websocket to tell the result: read it back.
      await this.refreshRest();
    }
  }

  /** Mode of a loadpoint (`off`, `pv`, `minpv`, `now`). */
  async setMode(externalId, mode) {
    const target = this.#target(externalId);
    if (target.kind !== 'loadpoint') {
      throw new CommandError('not_loadpoint', this.language);
    }
    if (!MODES.includes(mode)) {
      throw new CommandError('invalid_mode', this.language);
    }
    const { loadpoint } = target;
    await this.#send(
      (client) => client.setMode(loadpoint.id, mode),
      `${loadpoint.title}: mode ${mode}`,
    );
    return loadpoint;
  }

  /** Charge limit of a loadpoint (`soc` % or `energy` kWh) or of a vehicle (`soc`). */
  async setLimit(externalId, type, value) {
    const target = this.#target(externalId);
    const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
    if (type === 'energy') {
      if (target.kind === 'vehicle') {
        throw new CommandError('vehicle_energy', this.language);
      }
      if (target.kind !== 'loadpoint') {
        throw new CommandError('not_loadpoint', this.language);
      }
      if (!isInRange(number, LIMIT_ENERGY)) {
        throw new CommandError('out_of_range', this.language, 0, LIMIT_ENERGY.max, 'kWh');
      }
      const kwh = Math.round(number * 10) / 10;
      await this.#send(
        (client) => client.setLimitEnergy(target.loadpoint.id, kwh),
        `${target.loadpoint.title}: energy limit ${kwh} kWh`,
      );
      return;
    }
    if (!isInRange(number, LIMIT_SOC)) {
      throw new CommandError('out_of_range', this.language, LIMIT_SOC.min, LIMIT_SOC.max, '%');
    }
    const soc = Math.round(number);
    if (target.kind === 'loadpoint') {
      await this.#send(
        (client) => client.setLimitSoc(target.loadpoint.id, soc),
        `${target.loadpoint.title}: charge limit ${soc} %`,
      );
      return;
    }
    if (target.kind === 'vehicle') {
      await this.#send(
        (client) => client.setVehicleLimitSoc(target.vehicle.name, soc),
        `${target.vehicle.title}: charge limit ${soc} %`,
      );
      return;
    }
    throw new CommandError('not_loadpoint', this.language);
  }

  /** onSetValue: the mode and the charge limits. */
  async setValue(device, feature, value) {
    const target = this.#target(feature?.external_id ?? device?.external_id);
    if (target.feature === 'mode') {
      await this.setMode(device.external_id, String(value));
      return;
    }
    if (target.feature === 'limit_soc') {
      await this.setLimit(device.external_id, 'soc', value);
      return;
    }
    throw new Error(`Feature ${target.feature} cannot be controlled`);
  }

  /** onPoll: the devices are pushed; only refreshes when evcc went quiet. */
  async poll() {
    if (!this.live && this.now() - this.lastRestAt >= this.timings.restInterval) {
      await this.refreshRest();
    }
  }

  // --- "Test the connection" --------------------------------------------------

  async testReport() {
    if (!this.client) {
      return Object.fromEntries(Object.entries(TEST_TEXT).map(([lang, t]) => [lang, t.none]));
    }
    const ok = await this.refreshRest();
    const snapshot = this.snapshot;
    return Object.fromEntries(
      Object.entries(TEST_TEXT).map(([language, table]) => [
        language,
        ok && snapshot
          ? table.ok(
              snapshot.site.version ?? '?',
              snapshot.loadpoints.length,
              snapshot.vehicles.length,
            )
          : ['unauthorized', 'invalidAnswer'].includes(this.status)
            ? STATUS_TEXT[language][this.status]
            : table.failed,
      ]),
    );
  }

  /** Ids for the widget: the site and the loadpoints. */
  ids() {
    return {
      site: siteIds(this.gladys),
      loadpoint: (id) => loadpointIds(this.gladys, id),
    };
  }
}

function isInRange(value, { min, max }) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** What the widget shows changed enough to nudge it (not every power reading). */
function widgetChanged(before, after) {
  const key = (snapshot) =>
    JSON.stringify(snapshot.loadpoints.map((lp) => [lp.mode, lp.chargingState, lp.vehicleName]));
  return key(before) !== key(after);
}
