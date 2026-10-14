// The dashboard widget: content within the core's budget, mode buttons,
// degraded states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/widgets.js';
import { until } from './helpers/fakeEvcc.js';
import { createWorld, lpId } from './helpers/world.js';

const content = async (world, options = {}) => {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { language: 'fr', ...options });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

function checkBudget(widget) {
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.ok(widget.components.length <= 8);
  assert.ok(widget.components.filter((c) => c.type === 'text').length <= 2);
  assert.ok(widget.components.filter((c) => c.type === 'button').length <= 4);
  const keys = widget.components.filter((c) => c.action).map((c) => c.action.key);
  assert.equal(new Set(keys).size, keys.length, 'unique action keys');
  for (const status of widget.components.filter((c) => c.type === 'status')) {
    assert.ok(status.items.length <= 10);
    for (const item of status.items) {
      assert.ok(String(item.value).length <= 40 && item.label.length <= 40, item.label);
    }
  }
}

test('energy flow, loadpoints and the mode buttons of the first loadpoint', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of ['en', 'fr', 'de', 'es']) {
    checkBudget(await content(world, { language }));
  }
  const widget = await content(world);
  const tiles = widget.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((c) => [c.label, c.value, c.unit]),
    [
      ['Solaire', 8.5, 'kW'],
      ['Maison', 0.5, 'kW'],
      ['Réseau', -0.8, 'kW'],
    ],
  );
  const rows = widget.components.find((c) => c.type === 'status').items;
  assert.deepEqual(rows[0], { label: 'Batterie maison', value: '46 %', icon: 'battery' });
  assert.equal(rows[2].value, 'En charge · 3,2 kW · Solaire');
  const buttons = widget.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.icon]),
    [
      ['Arrêt', 'power'],
      ['Solaire', 'check-circle'],
      ['Min + solaire', 'sunrise'],
      ['Rapide', 'zap'],
    ],
  );
});

test('the widget setting chooses the loadpoint of the buttons; a button sets the mode', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const widget = await content(world, { settings: { device: lpId(2) } });
  const fast = widget.components.find((c) => c.action?.key === 'mode_now');
  assert.deepEqual(fast.action.params, { loadpoint: 2 });
  const ack = await world.fake.widgetAction(WIDGET_KEY, 'mode_now', fast.action.params, {
    settings: { device: lpId(2) },
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Garage : mode Rapide.');
  assert.deepEqual(world.server.writes.at(-1), { loadpoint: 2, mode: 'now' });
});

test('evcc down: last values with a caption, no button', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.server.stop();
  await until(() => world.hub.status !== 'online', { what: 'offline' });
  const widget = await content(world);
  checkBudget(widget);
  assert.equal(widget.components[0].text, 'evcc ne répond pas : dernières valeurs connues.');
  assert.equal(widget.components.filter((c) => c.type === 'button').length, 0);
});

test('not configured: a sentence', async (t) => {
  const world = await createWorld({ config: {}, waitOnline: false });
  t.after(() => world.app.stop());
  const widget = await content(world, { language: 'en' });
  checkBudget(widget);
  assert.match(widget.components[0].text, /address of evcc/);
});
