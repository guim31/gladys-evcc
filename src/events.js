// -----------------------------------------------------------------------------
// Scene events, derived from the successive snapshots of evcc (it has no
// event stream of its own):
//
// - vehicle_connected / vehicle_disconnected: the `connected` flag of a
//   loadpoint. evcc identifies the vehicle a little after the plug (up to a
//   minute when it asks the car makers' clouds): vehicle_connected waits for
//   it, IDENTIFY_MS at most, so a scene can filter on the vehicle;
// - charging_started / charging_finished: a charge, not every pause. In solar
//   mode evcc stops and resumes the charge with the clouds; a charge is
//   "finished" once it stayed stopped for QUIET_MS, or right away when the
//   vehicle is unplugged. A charge resumed after that is a new charge;
// - mode_changed: the mode of a loadpoint, whoever changed it (evcc's
//   interface, a vehicle default mode, Gladys).
//
// Nothing fires from the first snapshot after a (re)connection to evcc: it
// only sets the baseline, so a restart never replays what already happened.
// -----------------------------------------------------------------------------

export const QUIET_MS = 10 * 60_000;
export const IDENTIFY_MS = 2 * 60_000;

export const TRIGGERS = {
  connected: 'vehicle_connected',
  disconnected: 'vehicle_disconnected',
  started: 'charging_started',
  finished: 'charging_finished',
  mode: 'mode_changed',
};

export class SessionTracker {
  constructor({ quietMs = QUIET_MS, identifyMs = IDENTIFY_MS } = {}) {
    this.quietMs = quietMs;
    this.identifyMs = identifyMs;
    // loadpoint id -> { connected, charging, mode, inCharge, stoppedAt, last }
    this.loadpoints = new Map();
  }

  /** Forget the baseline (connection to evcc lost): the next snapshot sets it again. */
  reset() {
    for (const tracked of this.loadpoints.values()) {
      tracked.baseline = false;
    }
  }

  /**
   * Compare a snapshot with the previous one. Returns the events, in order:
   * `{ type, loadpoint, ... }` with `loadpoint` the snapshot entry.
   */
  update(snapshot, now) {
    const events = [];
    for (const lp of snapshot.loadpoints) {
      let tracked = this.loadpoints.get(lp.id);
      if (!tracked || !tracked.baseline) {
        // A charge already running when we (re)connect is followed to its end;
        // an interrupted charge we were following is not lost either.
        const inCharge = lp.charging || Boolean(tracked?.inCharge && lp.connected);
        tracked = {
          baseline: true,
          connected: lp.connected,
          charging: lp.charging,
          mode: lp.mode,
          inCharge,
          pluggedAt: null,
          stoppedAt: inCharge && !lp.charging ? (tracked?.stoppedAt ?? now) : null,
          last: lp,
        };
        this.loadpoints.set(lp.id, tracked);
        continue;
      }

      if (lp.mode && tracked.mode && lp.mode !== tracked.mode) {
        events.push({ type: 'mode', loadpoint: lp, previousMode: tracked.mode });
      }
      if (lp.mode) {
        tracked.mode = lp.mode;
      }

      if (lp.connected && !tracked.connected) {
        tracked.pluggedAt = now;
        tracked.connectedSince = now;
      }
      // A charge starting tells the vehicle is there, identified or not.
      events.push(...this.#identified(tracked, lp, now, lp.charging));

      if (lp.charging) {
        if (!tracked.inCharge) {
          events.push({ type: 'started', loadpoint: lp });
          tracked.inCharge = true;
        }
        tracked.stoppedAt = null;
      } else if (tracked.charging) {
        tracked.stoppedAt = now;
      }

      if (!lp.connected && tracked.connected) {
        // Unplugged before being announced: announced now, so the scenes
        // always see a connection before its disconnection.
        if (tracked.pluggedAt !== null) {
          events.push({ type: 'connected', loadpoint: tracked.last ?? lp });
          tracked.pluggedAt = null;
        }
        if (tracked.inCharge) {
          // Unplugged: the session values of the last snapshot where the
          // vehicle was still there (evcc may reset them on disconnect).
          events.push({ type: 'finished', loadpoint: mergeSession(lp, tracked.last) });
          tracked.inCharge = false;
          tracked.stoppedAt = null;
        }
        const session = mergeSession(lp, tracked.last);
        // evcc's connectedDuration stays 0 on some setups: our own clock then.
        if (!session.connectedDuration && tracked.connectedSince) {
          session.connectedDuration = (now - tracked.connectedSince) / 1000;
        }
        tracked.connectedSince = null;
        events.push({ type: 'disconnected', loadpoint: session });
      }

      tracked.connected = lp.connected;
      tracked.charging = lp.charging;
      if (lp.connected) {
        // evcc may clear the vehicle a frame before the unplug itself.
        tracked.last = {
          ...lp,
          vehicleName: lp.vehicleName ?? tracked.last?.vehicleName ?? null,
          vehicleTitle: lp.vehicleTitle ?? tracked.last?.vehicleTitle ?? null,
        };
      }
      events.push(...this.#quietEnd(tracked, lp, now));
    }
    return events;
  }

  /** Called by a timer too: a charge stopped long enough is finished. */
  tick(snapshot, now) {
    const events = [];
    for (const lp of snapshot.loadpoints) {
      const tracked = this.loadpoints.get(lp.id);
      if (tracked?.baseline) {
        events.push(...this.#identified(tracked, lp, now, false));
        events.push(...this.#quietEnd(tracked, lp, now));
      }
    }
    return events;
  }

  #identified(tracked, lp, now, force) {
    if (tracked.pluggedAt === null || !lp.connected) {
      return [];
    }
    if (force || lp.vehicleName || now - tracked.pluggedAt >= this.identifyMs) {
      tracked.pluggedAt = null;
      return [{ type: 'connected', loadpoint: lp }];
    }
    return [];
  }

  #quietEnd(tracked, lp, now) {
    if (tracked.inCharge && tracked.stoppedAt !== null && now - tracked.stoppedAt >= this.quietMs) {
      tracked.inCharge = false;
      tracked.stoppedAt = null;
      return [{ type: 'finished', loadpoint: lp }];
    }
    return [];
  }
}

/** The loadpoint after unplugging, with the vehicle and session of before. */
function mergeSession(now, before) {
  if (!before) {
    return now;
  }
  return {
    ...now,
    vehicleName: before.vehicleName,
    vehicleTitle: before.vehicleTitle,
    sessionEnergy: now.sessionEnergy || before.sessionEnergy,
    chargeDuration: now.chargeDuration || before.chargeDuration,
    connectedDuration: before.connectedDuration,
    sessionSolarPercentage: before.sessionSolarPercentage,
  };
}
