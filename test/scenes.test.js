// Scene actions against the fake evcc: what is sent, what is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, lpId, siteId, vehicleId } from './helpers/world.js';

test('set_mode sends the mode to the loadpoint', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('set_mode', { device: lpId(2), mode: 'pv' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.server.writes.at(-1), { loadpoint: 2, mode: 'pv' });
});

test('set_limit: battery level of a loadpoint or a vehicle, energy of a loadpoint', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const run = (fields) => world.fake.sceneAction('set_limit', fields);
  assert.equal((await run({ device: lpId(1), limit_type: 'soc', value: 80 })).success, true);
  assert.equal(
    (await run({ device: vehicleId('vehicle_1'), limit_type: 'soc', value: '90' })).success,
    true,
  );
  assert.equal((await run({ device: lpId(1), limit_type: 'energy', value: 12.5 })).success, true);
  assert.deepEqual(world.server.writes, [
    { loadpoint: 1, limitsoc: '80' },
    { vehicle: 'vehicle_1', limitsoc: '90' },
    { loadpoint: 1, limitenergy: '12.5' },
  ]);
});

test('refusals: vehicle energy, out of range, the site, an unknown device, evcc down', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const run = (key, fields) => world.fake.sceneAction(key, fields);
  const energy = await run('set_limit', {
    device: vehicleId('vehicle_1'),
    limit_type: 'energy',
    value: 10,
  });
  assert.equal(energy.success, false);
  assert.match(energy.error, /limite d'énergie/);
  assert.equal(
    (await run('set_limit', { device: lpId(1), limit_type: 'soc', value: 150 })).success,
    false,
  );
  assert.equal((await run('set_mode', { device: siteId(), mode: 'now' })).success, false);
  assert.equal((await run('set_mode', { device: 'ext:other:x', mode: 'now' })).success, false);
  assert.equal((await run('set_mode', { device: lpId(1), mode: 'turbo' })).success, false);
  assert.equal(world.server.writes.length, 0);
  world.server.stop();
  const down = await run('set_mode', { device: lpId(1), mode: 'now' });
  assert.equal(down.success, false);
  assert.match(down.error, /evcc ne répond pas/);
});
