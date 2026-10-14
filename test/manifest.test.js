// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES } from '../src/config.js';
import { MODES } from '../src/evcc/model.js';
import { TRIGGERS } from '../src/events.js';
import { LIMIT_ENERGY, WIDGET_KEY } from '../src/hub.js';
import { LIMIT_TYPES, SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { createWorld, lpId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

test('identity: name, image, local transport, energy category', () => {
  assert.equal(manifest.name, 'evcc');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-evcc:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-evcc/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['energy']);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0, no more', () => {
  // No widget button opens a form: 5.2.0 is not needed.
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('config_schema: the defaults and options of the code', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(keys.sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
  assert.equal(manifest.config_schema.find((f) => f.key === 'password').type, 'secret');
  assert.equal(manifest.config_schema.find((f) => f.key === 'password').required, false);
  const languages = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(
    languages.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(languages.default, 'fr');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('every manifest action, scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { fake } = world;
  assert.match((await fake.action('nope')).error, /not implemented/i);
  for (const action of manifest.actions) {
    const ack = await fake.action(action.key, {});
    assert.equal(ack.success, true, `action ${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    const ack = await fake.sceneAction(action.key, { device: 'unknown' });
    assert.doesNotMatch(ack.error ?? '', /not implemented/i, action.key);
  }
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal((await fake.widgetGet(WIDGET_KEY, { settings: {} })).success, true);
});

test('scene action fields are the ones the code reads', async (t) => {
  const setMode = manifest.scene_actions.find((a) => a.key === 'set_mode');
  assert.deepEqual(
    setMode.fields.find((f) => f.key === 'mode').options.map((o) => o.value),
    MODES,
  );
  const setLimit = manifest.scene_actions.find((a) => a.key === 'set_limit');
  assert.deepEqual(
    setLimit.fields.find((f) => f.key === 'limit_type').options.map((o) => o.value),
    LIMIT_TYPES,
  );
  assert.equal(setLimit.fields.find((f) => f.key === 'value').max, LIMIT_ENERGY.max);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('set_mode', { device: lpId(1), mode: 'now' });
  assert.equal(ack.success, true, ack.error);
});

test('the scene triggers are declared with the filters and variables the hub sends', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const modeChanged = manifest.scene_triggers.find((t) => t.key === 'mode_changed');
  assert.deepEqual(
    modeChanged.fields.find((f) => f.key === 'mode').options.map((o) => o.value),
    MODES,
  );
  // The data sent per trigger (test/hub.test.js checks the values themselves).
  const sent = {
    vehicle_connected: ['device', 'loadpoint', 'vehicle_device', 'vehicle'],
    vehicle_disconnected: [
      'device',
      'loadpoint',
      'vehicle_device',
      'vehicle',
      'energy_kwh',
      'duration_minutes',
    ],
    charging_started: ['device', 'loadpoint', 'vehicle_device', 'vehicle', 'mode'],
    charging_finished: [
      'device',
      'loadpoint',
      'vehicle_device',
      'vehicle',
      'energy_kwh',
      'duration_minutes',
      'solar_percent',
    ],
    mode_changed: ['device', 'loadpoint', 'mode', 'previous_mode', 'mode_label'],
  };
  for (const trigger of manifest.scene_triggers) {
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(sent[trigger.key].includes(key), `${trigger.key}: "${key}" is sent`);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (Gladys#3154/#3155)', () => {
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
