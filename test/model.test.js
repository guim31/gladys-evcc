// The evcc state of two generations (answers recorded on evcc --demo 0.210.0
// and 0.317.1), the websocket frames, the modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARGING_STATE,
  applyMessage,
  normalizeMode,
  parseTime,
  snapshotOf,
  unwrapState,
} from '../src/evcc/model.js';
import { fixture } from './helpers/fakeEvcc.js';

test('evcc 0.317: site, loadpoints and vehicles', () => {
  const snapshot = snapshotOf(unwrapState(fixture('state-0.317.1.json')));
  assert.equal(snapshot.site.version, '0.317.1');
  assert.equal(snapshot.site.hasPv, true);
  assert.equal(snapshot.site.hasGrid, true);
  assert.equal(snapshot.site.hasBattery, true);
  assert.equal(snapshot.site.batterySoc, 46);
  assert.equal(snapshot.site.gridPrice, 0.313);
  assert.ok(snapshot.site.gridPower < 0, 'exporting');
  assert.equal(snapshot.loadpoints.length, 3);
  const [carport, garage, heatPump] = snapshot.loadpoints;
  assert.equal(carport.title, 'Carport');
  // `smart` without always charge is the historical `pv`.
  assert.equal(carport.mode, 'pv');
  assert.equal(carport.chargingState, CHARGING_STATE.CHARGING);
  assert.equal(carport.vehicleName, 'vehicle_1');
  assert.equal(garage.mode, 'off');
  assert.equal(garage.chargingState, CHARGING_STATE.EV_CONNECTED);
  assert.equal(heatPump.integrated, true);
  assert.deepEqual(
    snapshot.vehicles.map((v) => v.name),
    ['vehicle_1', 'vehicle_2', 'vehicle_3', 'vehicle_4'],
  );
});

test('evcc 0.210: battery as an array with the totals at the top', () => {
  const snapshot = snapshotOf(unwrapState(fixture('state-0.210.0.json')));
  assert.equal(snapshot.site.version, '0.210.0');
  assert.equal(snapshot.site.hasBattery, true);
  assert.equal(snapshot.site.batterySoc, 51);
  assert.equal(snapshot.site.hasGrid, true);
  assert.equal(snapshot.loadpoints[0].mode, 'pv');
  assert.equal(snapshot.loadpoints[1].chargingState, CHARGING_STATE.EV_CONNECTED);
});

test('evcc before 0.200: the `result` wrapper and gridPower', () => {
  const old = structuredClone(fixture('state-0.210.0.json'));
  delete old.grid;
  old.gridPower = 1234;
  const snapshot = snapshotOf(unwrapState({ result: old }));
  assert.equal(snapshot.site.gridPower, 1234);
  assert.equal(unwrapState({ result: 'x' }), null);
  assert.equal(unwrapState({ not: 'evcc' }), null);
  assert.equal(unwrapState(null), null);
});

test('modes of every version map to off, pv, minpv, now', () => {
  assert.equal(normalizeMode('smart', 'off'), 'pv');
  assert.equal(normalizeMode('smart', 'on'), 'minpv');
  assert.equal(normalizeMode('smart', 'once'), 'minpv');
  assert.equal(normalizeMode('smart', undefined), 'pv');
  for (const mode of ['off', 'pv', 'minpv', 'now']) {
    assert.equal(normalizeMode(mode), mode);
  }
  assert.equal(normalizeMode('boost'), null);
});

test('charging states: waiting for the sun, vehicle full, unplugged', () => {
  const lp = (patch) =>
    snapshotOf({ loadpoints: [{ mode: 'pv', connected: true, charging: false, ...patch }] })
      .loadpoints[0];
  assert.equal(lp({ enabled: false }).chargingState, CHARGING_STATE.PAUSED_BY_CHARGER);
  assert.equal(lp({ enabled: true }).chargingState, CHARGING_STATE.PAUSED_BY_VEHICLE);
  assert.equal(lp({ connected: false }).chargingState, CHARGING_STATE.IDLE);
  assert.equal(lp({ charging: true }).chargingState, CHARGING_STATE.CHARGING);
});

test('websocket frames update the state, the large keys are dropped', () => {
  const frames = fixture('ws-0.317.1.json');
  const state = {};
  for (const frame of frames) {
    applyMessage(state, frame);
  }
  assert.equal(state.loadpoints.length, 3);
  assert.equal(state.loadpoints[0].title, 'Carport');
  assert.equal(state.forecast, undefined);
  const touched = applyMessage(state, { 'loadpoints.1.mode': 'now', homePower: 900 });
  assert.deepEqual([...touched].sort(), ['homePower', 'loadpoints']);
  const snapshot = snapshotOf(state);
  assert.equal(snapshot.loadpoints[1].mode, 'now');
  assert.equal(snapshot.site.homePower, 900);
  applyMessage(state, { 'loadpoints.99.mode': 'now' });
  assert.equal(state.loadpoints.length, 3, 'absurd index ignored');
});

test('times: none, zero time, RFC 3339', () => {
  assert.equal(parseTime(null), null);
  assert.equal(parseTime('0001-01-01T00:00:00Z'), null);
  assert.equal(parseTime('2026-10-15T05:00:00Z'), Date.parse('2026-10-15T05:00:00Z'));
});
