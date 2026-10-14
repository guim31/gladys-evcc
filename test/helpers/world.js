// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and a
// fake evcc on a fake network. Store under a temporary folder. Short timings:
// the states are flushed within a few milliseconds.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { createEvcc, network, settle, until } from './fakeEvcc.js';

export const FAST_TIMINGS = {
  restInterval: 40,
  processDelay: 2,
  processMaxWait: 20,
  flushDelay: 5,
  minFlushGap: 10,
  tickInterval: 20,
};
export const FAST_SOCKET = { reconnectMin: 20, reconnectMax: 100, idleTimeout: 60_000 };

/**
 * @param {object} [options]
 * @param {object} [options.evcc] the fake evcc (default: 0.317.1 demo)
 * @param {object} [options.config] integration config (default: the fake's address)
 */
export async function createWorld({
  evcc,
  config,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'evcc-test-')),
  timings = FAST_TIMINGS,
  sessionTimings,
  now,
  waitOnline = true,
} = {}) {
  const server = evcc ?? createEvcc();
  const net = network(server);
  const gladys = createFakeGladys({
    config: config ?? { url: server.url },
    devices,
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: net.fetch,
    createSocket: net.createSocket,
    timings,
    socketTimings: FAST_SOCKET,
    sessionTimings,
    now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
    if (waitOnline && !server.down) {
      await until(() => app.hub.status === 'online' && gladys.fake.states.length > 0, {
        what: 'the first states',
      });
    }
  }
  return { gladys, fake: gladys.fake, app, hub: app.hub, server, dataDir };
}

export const siteId = (key) => `ext:test-integration:site:main${key ? `:${key}` : ''}`;
export const lpId = (id = 1, key) => `ext:test-integration:loadpoint:${id}${key ? `:${key}` : ''}`;
export const vehicleId = (name = 'vehicle_1', key) =>
  `ext:test-integration:vehicle:${name}${key ? `:${key}` : ''}`;

/** Wait for the hub's next flush of states. */
export async function flushed(world) {
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await world.hub.flush();
  await settle();
}
