// The integration end to end, on the SDK's fake Gladys and a fake evcc built
// from recorded answers: devices, states, websocket updates, commands, admin
// password, evcc going down and back, persistence, scene events, quiet logs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, createEvcc, fixture, settle, until } from './helpers/fakeEvcc.js';
import { captureLogs } from './helpers/logs.js';
import { createWorld, flushed, lpId, siteId, vehicleId } from './helpers/world.js';

const deviceOf = (fake, id) => fake.discoveredDevices.find((d) => d.external_id === id);
const featureOf = (device, key) =>
  device.features.find((f) => f.external_id === `${device.external_id}:${key}`);

test('one site, one device per loadpoint and per vehicle, none polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake } = world;
  assert.deepEqual(
    fake.discoveredDevices.map((d) => d.external_id),
    [
      siteId(),
      lpId(1),
      lpId(2),
      lpId(3),
      vehicleId('vehicle_1'),
      vehicleId('vehicle_2'),
      vehicleId('vehicle_3'),
      vehicleId('vehicle_4'),
    ],
  );
  for (const device of fake.discoveredDevices) {
    assert.equal(device.should_poll, false, device.name);
    assert.equal(device.poll_frequency, undefined, device.name);
  }
  // The heat pump (an integrated device) has no vehicle features.
  const heatPump = deviceOf(fake, lpId(3));
  assert.equal(featureOf(heatPump, 'plugged'), undefined);
  assert.ok(featureOf(heatPump, 'mode'));
  assert.deepEqual(fake.connectionStatus, { connected: true });
});

test('states of the site, a loadpoint and a vehicle', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake } = world;
  assert.equal(fake.lastState(siteId('pv_power')), 8450);
  assert.equal(fake.lastState(siteId('grid_power')), -840);
  assert.equal(fake.lastState(siteId('battery_level')), 46);
  assert.equal(fake.lastState(siteId('grid_price')), 0.313);
  assert.equal(fake.lastState(lpId(1, 'mode')), 'pv');
  assert.equal(fake.lastState(lpId(1, 'charging_state')), 0);
  assert.equal(fake.lastState(lpId(1, 'charge_power')), 3.22);
  assert.equal(fake.lastState(lpId(1, 'plugged')), 1);
  assert.equal(fake.lastState(lpId(1, 'remaining_time')), 375);
  assert.equal(fake.lastState(lpId(1, 'vehicle')), 'blue e-Golf');
  assert.equal(fake.lastState(lpId(2, 'mode')), 'off');
  assert.equal(fake.lastState(vehicleId('vehicle_1', 'soc')), 62);
  assert.equal(fake.lastState(vehicleId('vehicle_1', 'range')), 182);
  assert.equal(fake.lastState(vehicleId('vehicle_1', 'plan')), 'Aucun plan');
  // Not plugged in: no battery level known, plugged at 0.
  assert.equal(fake.lastState(vehicleId('vehicle_3', 'soc')), undefined);
  assert.equal(fake.lastState(vehicleId('vehicle_3', 'plugged')), 0);
});

test('websocket updates are published, only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake, server } = world;
  const before = fake.states.length;
  server.setSite({ homePower: 1234 });
  server.setLoadpoint(0, { chargePower: 7400 });
  await flushed(world);
  assert.equal(fake.lastState(siteId('home_power')), 1230);
  assert.equal(fake.lastState(lpId(1, 'charge_power')), 7.4);
  assert.equal(fake.states.length, before + 2, 'two values changed, two states');
  server.setSite({ homePower: 1232 });
  await flushed(world);
  assert.equal(fake.states.length, before + 2, 'rounded to 10 W: no new state');
});

test('states are published again when the user adds a device, and the widget refreshed', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake } = world;
  const before = fake.states.length;
  const widgetRefreshes = fake.widgetRefreshes.length;
  world.hub.widgetRefreshAt = 0;
  await fake.deviceCreated(deviceOf(fake, lpId(1)));
  await settle();
  const again = fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.ok(again.includes(lpId(1, 'mode')));
  assert.ok(!again.includes(siteId('pv_power')), 'only the created device');
  assert.ok(fake.widgetRefreshes.length > widgetRefreshes);
});

test('mode from the dashboard: evcc 0.317 gets pv/minpv, reports smart, the state follows', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake, server } = world;
  const device = deviceOf(fake, lpId(2));
  const ack = await fake.setValue(device, featureOf(device, 'mode'), 'minpv');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.writes.at(-1), { loadpoint: 2, mode: 'minpv' });
  assert.equal(server.state.loadpoints[1].mode, 'smart');
  assert.equal(server.state.loadpoints[1].alwaysCharge, 'on');
  await flushed(world);
  assert.equal(fake.lastState(lpId(2, 'mode')), 'minpv');
  const refused = await fake.setValue(device, featureOf(device, 'mode'), 'turbo');
  assert.equal(refused.success, false);
  assert.match(refused.error, /Mode de charge inconnu/);
});

test('charge limits of a loadpoint and of a vehicle', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake, server } = world;
  const lp = deviceOf(fake, lpId(1));
  assert.equal((await fake.setValue(lp, featureOf(lp, 'limit_soc'), 80)).success, true);
  const vehicle = deviceOf(fake, vehicleId('vehicle_2'));
  assert.equal((await fake.setValue(vehicle, featureOf(vehicle, 'limit_soc'), 70)).success, true);
  assert.deepEqual(server.writes.slice(-2), [
    { loadpoint: 1, limitsoc: '80' },
    { vehicle: 'vehicle_2', limitsoc: '70' },
  ]);
  await flushed(world);
  assert.equal(fake.lastState(lpId(1, 'limit_soc')), 80);
  assert.equal(fake.lastState(vehicleId('vehicle_2', 'limit_soc')), 70);
  const tooHigh = await fake.setValue(lp, featureOf(lp, 'limit_soc'), 120);
  assert.equal(tooHigh.success, false);
  assert.equal(server.writes.length, 2, 'nothing sent out of range');
});

test('the admin password: login on 401, the command goes through', async (t) => {
  const server = createEvcc({ password: PASSWORD });
  const world = await createWorld({
    evcc: server,
    config: { url: server.url, password: PASSWORD },
  });
  t.after(() => world.app.stop());
  assert.equal(world.hub.status, 'online');
  const device = deviceOf(world.fake, lpId(1));
  const ack = await world.fake.setValue(device, featureOf(device, 'mode'), 'now');
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    server.requests.filter((r) => r.path === '/api/auth/login').length,
    1,
    'one login, the session is reused',
  );
});

test('a wrong or missing password is said in the connection status', async (t) => {
  const server = createEvcc({ password: PASSWORD, websocket: false });
  const world = await createWorld({ evcc: server, config: { url: server.url }, waitOnline: false });
  t.after(() => world.app.stop());
  await until(() => world.hub.status === 'unauthorized', { what: 'unauthorized' });
  const status = world.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /mot de passe administrateur/);
});

test('evcc down: status, last values kept, back by itself; REST while the websocket is down', async (t) => {
  const logs = captureLogs(t, 'info');
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake, server } = world;
  server.stop();
  await until(() => fake.connectionStatus?.connected === false, { what: 'disconnected' });
  assert.match(fake.connectionStatus.message.en, /does not answer/);
  // Several failed reads, one warning.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(logs.lines.filter((line) => /Cannot read evcc/.test(line)).length, 1);
  assert.ok(!logs.lines.some((line) => line.includes(PASSWORD)));

  server.restart();
  await until(() => fake.connectionStatus?.connected === true, { what: 'reconnected' });
  server.setSite({ homePower: 2000 });
  await until(() => fake.lastState(siteId('home_power')) === 2000, { what: 'new value' });
  assert.ok(logs.lines.some((line) => /evcc answers again/.test(line)));
});

test('without websocket, the state is read by REST at its own pace', async (t) => {
  const server = createEvcc({ websocket: false });
  const world = await createWorld({ evcc: server });
  t.after(() => world.app.stop());
  assert.equal(world.hub.status, 'online');
  server.state.homePower = 3333;
  await until(() => world.fake.lastState(siteId('home_power')) === 3330, { what: 'REST read' });
});

test('evcc before 0.200 (wrapped answer) and 0.210 work the same', async (t) => {
  const server = createEvcc({ state: fixture('state-0.210.0.json'), wrap: true, websocket: false });
  const world = await createWorld({ evcc: server });
  t.after(() => world.app.stop());
  assert.equal(world.fake.lastState(siteId('battery_level')), 51);
  assert.equal(world.fake.lastState(lpId(1, 'mode')), 'pv');
  const device = deviceOf(world.fake, lpId(1));
  assert.equal(
    (await world.fake.setValue(device, featureOf(device, 'mode'), 'minpv')).success,
    true,
  );
  await until(() => world.fake.lastState(lpId(1, 'mode')) === 'minpv', { what: 'minpv' });
});

test('the structure survives a restart while evcc is off', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const server = createEvcc();
  server.stop();
  const second = await createWorld({ evcc: server, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  await settle();
  assert.equal(second.fake.discoveredDevices.length, 8);
  assert.equal(second.hub.status === 'online', false);
});

test('no address configured: said in the status, nothing published', async (t) => {
  const world = await createWorld({ config: {}, waitOnline: false });
  t.after(() => world.app.stop());
  await settle();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
  assert.equal(world.fake.discoveredDevices.length, 0);
  const report = await world.fake.action('test_connection', {});
  assert.match(report.data.message.en, /address of evcc first/);
});

test('test the connection', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.fr, 'evcc 0.317.1 répond : 3 point(s) de charge, 4 véhicule(s).');
});

test('a normal cycle writes nothing at info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const logs = captureLogs(t, 'info');
  for (let i = 0; i < 5; i += 1) {
    world.server.setSite({ homePower: 500 + i * 100, grid: { name: 'grid', power: -100 * i } });
    world.server.setLoadpoint(0, { chargePower: 3000 + i * 50, sessionEnergy: 100 * i });
    await flushed(world);
  }
  assert.deepEqual(logs.stop(), []);
});

// --- Scene events ------------------------------------------------------------

const SESSION = { quietMs: 60, identifyMs: 60 };

test('nothing fires from the first snapshot', async (t) => {
  const world = await createWorld({ sessionTimings: SESSION });
  t.after(() => world.app.stop());
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('a session: plugged in, identified, charging, pause, finished, unplugged', async (t) => {
  const world = await createWorld({ sessionTimings: SESSION });
  t.after(() => world.app.stop());
  const { fake, server } = world;
  // Garage: unplug the Model 3 first.
  server.setLoadpoint(1, { connected: false, vehicleName: '', vehicleTitle: '' });
  await flushed(world);
  assert.deepEqual(
    fake.sceneEvents.map((e) => e.key),
    ['vehicle_disconnected'],
  );
  assert.equal(fake.sceneEvents[0].data.vehicle, 'white Model 3');
  assert.equal(fake.sceneEvents[0].data.vehicle_device, vehicleId('vehicle_2'));

  // Plugged in: announced once evcc knows the vehicle.
  server.setLoadpoint(1, { connected: true });
  await flushed(world);
  assert.equal(fake.sceneEvents.length, 1, 'waiting for the identification');
  server.setLoadpoint(1, { vehicleName: 'vehicle_2', vehicleTitle: 'white Model 3' });
  await flushed(world);
  assert.deepEqual(fake.sceneEvents[1], {
    key: 'vehicle_connected',
    data: {
      device: lpId(2),
      loadpoint: 'Garage',
      vehicle_device: vehicleId('vehicle_2'),
      vehicle: 'white Model 3',
    },
  });

  server.setLoadpoint(1, { mode: 'now', charging: true, enabled: true });
  await flushed(world);
  const keys = () => fake.sceneEvents.map((e) => e.key);
  assert.deepEqual(keys().slice(2), ['mode_changed', 'charging_started']);
  assert.deepEqual(fake.sceneEvents[2].data, {
    device: lpId(2),
    loadpoint: 'Garage',
    mode: 'now',
    previous_mode: 'off',
    mode_label: 'Rapide',
  });

  // A short pause is not the end of the charge.
  server.setLoadpoint(1, { charging: false });
  await flushed(world);
  server.setLoadpoint(1, { charging: true });
  await flushed(world);
  assert.equal(keys().length, 4);

  // Stopped for good: finished after the quiet period.
  server.setLoadpoint(1, {
    charging: false,
    sessionEnergy: 12345,
    chargeDuration: 3600,
    sessionSolarPercentage: 72.4,
  });
  await until(() => keys().includes('charging_finished'), { what: 'charging_finished' });
  assert.deepEqual(fake.sceneEvents.at(-1).data, {
    device: lpId(2),
    loadpoint: 'Garage',
    vehicle_device: vehicleId('vehicle_2'),
    vehicle: 'white Model 3',
    energy_kwh: 12.35,
    duration_minutes: 60,
    solar_percent: 72,
  });

  server.setLoadpoint(1, { connectedDuration: 7200 });
  await flushed(world);
  server.setLoadpoint(1, { vehicleName: '', vehicleTitle: '' });
  server.setLoadpoint(1, { connected: false });
  await flushed(world);
  assert.equal(keys().at(-1), 'vehicle_disconnected');
  assert.equal(fake.sceneEvents.at(-1).data.duration_minutes, 120);
  assert.equal(keys().filter((k) => k === 'charging_finished').length, 1);
});

test('unplugged while charging: finished, then unplugged', async (t) => {
  const world = await createWorld({ sessionTimings: SESSION });
  t.after(() => world.app.stop());
  world.server.setLoadpoint(0, { connected: false, charging: false });
  await flushed(world);
  assert.deepEqual(
    world.fake.sceneEvents.map((e) => e.key),
    ['charging_finished', 'vehicle_disconnected'],
  );
  assert.equal(world.fake.sceneEvents[0].data.vehicle, 'blue e-Golf');
});

test('a vehicle never identified is announced after the delay', async (t) => {
  const world = await createWorld({ sessionTimings: SESSION });
  t.after(() => world.app.stop());
  world.server.setLoadpoint(1, { connected: false, vehicleName: '' });
  await flushed(world);
  world.server.setLoadpoint(1, { connected: true });
  await until(() => world.fake.sceneEvents.some((e) => e.key === 'vehicle_connected'), {
    what: 'vehicle_connected',
  });
  const event = world.fake.sceneEvents.find((e) => e.key === 'vehicle_connected');
  assert.equal(event.data.vehicle, '');
  assert.equal(event.data.vehicle_device, '');
});

test('emptying the address while connected says so, and evcc is no longer read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const requests = world.server.requests.length;
  await world.fake.configUpdated({ url: '' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(world.hub.status, 'none');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.server.requests.length, requests, 'no read with the old client');
});

test('unplugged: the time plugged in falls back on our own clock', async (t) => {
  const world = await createWorld({ sessionTimings: SESSION });
  t.after(() => world.app.stop());
  world.server.setLoadpoint(1, { connected: false });
  await flushed(world);
  world.server.setLoadpoint(1, { connected: true });
  await flushed(world);
  world.server.setLoadpoint(1, { connected: false, connectedDuration: 0 });
  await flushed(world);
  const event = world.fake.sceneEvents.at(-1);
  assert.equal(event.key, 'vehicle_disconnected');
  assert.equal(typeof event.data.duration_minutes, 'number');
});
