// -----------------------------------------------------------------------------
// The evcc state, as /api/state returns it and as the websocket updates it,
// turned into a small snapshot the rest of the code reads.
//
// Versions (answers recorded on evcc 0.210.0 and 0.317.1, test/fixtures/evcc/):
// - before 0.200, /api/state wrapped everything in `{ result: ... }`;
// - 0.2xx: `batteryPower`, `batterySoc` at the top, `battery` an array;
//   newer: `battery` an object `{ power, soc, devices }`. `gridPower` (old)
//   became `grid.power`;
// - 0.317 (PR evcc-io/evcc#32490, September 2026): the `pv` mode is called
//   `smart`, and `minpv` became `smart` + the loadpoint option `alwaysCharge`.
//   The write paths still accept `pv` and `minpv` and translate them. This
//   integration keeps the four historical values (`off`, `pv`, `minpv`, `now`)
//   as its own stable vocabulary, valid on every version.
//
// The websocket sends one JSON object per change: `{ "loadpoints.0.chargePower":
// 3220 }`, `{ "grid": { "power": -630 } }`; the first frame holds every key.
// Energies (`sessionEnergy`, `chargedEnergy`) are in Wh, durations in seconds.
// -----------------------------------------------------------------------------

export const MODES = ['off', 'pv', 'minpv', 'now'];

// Charging state of a loadpoint, the enumeration of `charging-station/charging-state`
// (CHARGING_STATION_CHARGING_STATE of the Gladys core, translated by its front).
export const CHARGING_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
};

// Keys never read: dropped at once. Some are large (forecasts: 256 MB
// sandbox), others hold credentials of evcc's own settings (MQTT, InfluxDB,
// messaging, EEBUS certificate) that have nothing to do in this process.
const IGNORED =
  /^(forecast|eebus|mqtt|influx|messaging|messagingEvents|shm|hems|ocpp\w*|modbusproxy|sponsor|network|remote|releaseNotes|tariffs|statistics)(\.|$)/;

/** The raw state of /api/state, unwrapped (evcc < 0.200 answers `{ result }`). */
export function unwrapState(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const state =
    body.result && typeof body.result === 'object' && Object.keys(body).length === 1
      ? body.result
      : body;
  return Array.isArray(state.loadpoints) ? stripIgnored(state) : null;
}

function stripIgnored(state) {
  const copy = {};
  for (const [key, value] of Object.entries(state)) {
    if (!IGNORED.test(key)) {
      copy[key] = value;
    }
  }
  return copy;
}

/**
 * Apply one websocket frame to a raw state (mutated). Returns the set of
 * top-level keys touched (`loadpoints` for any loadpoint field).
 */
export function applyMessage(state, message) {
  const touched = new Set();
  if (!message || typeof message !== 'object') {
    return touched;
  }
  for (const [key, value] of Object.entries(message)) {
    if (IGNORED.test(key)) {
      continue;
    }
    const indexed = key.match(/^([A-Za-z]+)\.(\d+)\.([A-Za-z0-9_]+)$/);
    if (indexed) {
      const [, domain, index, field] = indexed;
      if (!Array.isArray(state[domain])) {
        state[domain] = [];
      }
      const list = state[domain];
      const position = Number(index);
      if (position > 50) {
        continue;
      }
      while (list.length <= position) {
        list.push({});
      }
      if (!list[position] || typeof list[position] !== 'object') {
        list[position] = {};
      }
      list[position][field] = value;
      touched.add(domain);
      continue;
    }
    const nested = key.match(/^([A-Za-z]+)\.([A-Za-z0-9_]+)$/);
    if (nested) {
      const [, domain, field] = nested;
      if (!state[domain] || typeof state[domain] !== 'object' || Array.isArray(state[domain])) {
        state[domain] = {};
      }
      state[domain][field] = value;
      touched.add(domain);
      continue;
    }
    state[key] = value;
    touched.add(key);
  }
  return touched;
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const bool = (value) => (typeof value === 'boolean' ? value : null);
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** evcc's mode (any version) -> one of MODES, or null when unknown. */
export function normalizeMode(mode, alwaysCharge) {
  if (mode === 'smart') {
    return alwaysCharge === 'on' || alwaysCharge === 'once' ? 'minpv' : 'pv';
  }
  return MODES.includes(mode) ? mode : null;
}

/** A time evcc sends (RFC 3339; `0001-01-01T00:00:00Z` or null for none). */
export function parseTime(value) {
  if (typeof value !== 'string' || value.startsWith('0001-')) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function siteOf(state) {
  const pvList = Array.isArray(state.pv) ? state.pv : null;
  const pvPower =
    num(state.pvPower) ??
    (pvList && pvList.length > 0
      ? pvList.reduce((sum, pv) => sum + (num(pv?.power) ?? 0), 0)
      : null);

  const gridPower = num(state.grid?.power) ?? num(state.gridPower);

  // Battery: an object (recent), or an array with the totals at the top (0.2xx).
  let batterySoc = null;
  let batteryPower = null;
  let hasBattery = false;
  if (state.battery && typeof state.battery === 'object' && !Array.isArray(state.battery)) {
    hasBattery =
      (Array.isArray(state.battery.devices) && state.battery.devices.length > 0) ||
      num(state.battery.soc) !== null;
    batterySoc = num(state.battery.soc);
    batteryPower = num(state.battery.power);
  } else if (Array.isArray(state.battery)) {
    hasBattery = state.battery.length > 0;
    batterySoc = num(state.batterySoc);
    batteryPower = num(state.batteryPower);
  } else if (num(state.batterySoc) !== null) {
    hasBattery = true;
    batterySoc = num(state.batterySoc);
    batteryPower = num(state.batteryPower);
  }

  return {
    title: text(state.siteTitle),
    version: text(state.version)?.split(' ')[0] ?? null,
    currency: text(state.currency) ?? 'EUR',
    pvPower,
    hasPv: pvPower !== null && (pvList === null || pvList.length > 0),
    homePower: num(state.homePower),
    gridPower,
    // `gridConfigured` is false when evcc has no grid meter (then grid is 0).
    hasGrid: gridPower !== null && state.gridConfigured !== false,
    hasBattery,
    batterySoc,
    // evcc: positive = the battery discharges into the house.
    batteryPower,
    gridPrice: num(state.tariffGrid),
    // A dynamic tariff (or CO2 signal) lets evcc charge when the grid is cheap.
    hasSmartCost: state.smartCostAvailable === true || text(state.smartCostType) !== null,
    feedInPrice: num(state.tariffFeedIn),
  };
}

function loadpointOf(raw, index) {
  const lp = raw && typeof raw === 'object' ? raw : {};
  const connected = bool(lp.connected) ?? false;
  const charging = bool(lp.charging) ?? false;
  const mode = normalizeMode(lp.mode, lp.alwaysCharge);
  let chargingState = CHARGING_STATE.IDLE;
  if (connected) {
    if (charging) {
      chargingState = CHARGING_STATE.CHARGING;
    } else if (mode === 'off') {
      chargingState = CHARGING_STATE.EV_CONNECTED;
    } else if (lp.enabled === false) {
      // evcc holds the charge (waiting for the sun, a cheap slot, a plan).
      chargingState = CHARGING_STATE.PAUSED_BY_CHARGER;
    } else {
      // Enabled but not drawing: the car is full or stopped by itself.
      chargingState = CHARGING_STATE.PAUSED_BY_VEHICLE;
    }
  }
  const vehicleName = text(lp.vehicleName);
  return {
    id: index + 1,
    title: text(lp.title) ?? `Loadpoint ${index + 1}`,
    mode,
    connected,
    charging,
    enabled: bool(lp.enabled),
    chargingState,
    chargePower: num(lp.chargePower),
    offeredCurrent: num(lp.offeredCurrent),
    phases: num(lp.phasesActive),
    sessionEnergy: num(lp.sessionEnergy) ?? num(lp.chargedEnergy),
    sessionSolarPercentage: num(lp.sessionSolarPercentage),
    chargeDuration: num(lp.chargeDuration),
    connectedDuration: num(lp.connectedDuration),
    remainingDuration: num(lp.chargeRemainingDuration),
    limitSoc: num(lp.limitSoc),
    effectiveLimitSoc: num(lp.effectiveLimitSoc),
    limitEnergy: num(lp.limitEnergy),
    vehicleName,
    vehicleTitle: text(lp.vehicleTitle),
    vehicleSoc: num(lp.vehicleSoc),
    vehicleRange: num(lp.vehicleRange),
    smartCostActive: bool(lp.smartCostActive),
    // Total of the charger meter (kWh), when the charger has one.
    totalImport: num(lp.chargeTotalImport),
    planTime: parseTime(lp.effectivePlanTime),
    planSoc: num(lp.effectivePlanSoc),
    // Integrated devices (heat pump, switched socket): not a vehicle charger.
    integrated: lp.chargerFeatureIntegratedDevice === true,
  };
}

function vehiclesOf(state) {
  const raw = state.vehicles;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }
  return Object.entries(raw)
    .filter(([name, vehicle]) => text(name) && vehicle && typeof vehicle === 'object')
    .map(([name, vehicle]) => ({
      name,
      title: text(vehicle.title) ?? name,
      capacity: num(vehicle.capacity),
      limitSoc: num(vehicle.limitSoc),
      minSoc: num(vehicle.minSoc),
      planTime: parseTime(vehicle.plan?.time),
      planSoc: num(vehicle.plan?.soc),
    }));
}

/** The snapshot of a raw state: what the devices, events and widget read. */
export function snapshotOf(state) {
  const loadpoints = (Array.isArray(state.loadpoints) ? state.loadpoints : []).map(loadpointOf);
  return {
    site: siteOf(state),
    loadpoints,
    vehicles: vehiclesOf(state),
  };
}

/** Where a vehicle is plugged in, or null. */
export function loadpointOfVehicle(snapshot, name) {
  return snapshot.loadpoints.find((lp) => lp.connected && lp.vehicleName === name) ?? null;
}
