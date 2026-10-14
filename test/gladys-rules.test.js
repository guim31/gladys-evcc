// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: evcc --demo 0.317.1 (PV, battery, grid price, three loadpoints
// including a heat pump, four vehicles), evcc --demo 0.210.0, and a charger
// alone with its own meter (no PV, no battery) — in every name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEvcc, fixture } from './helpers/fakeEvcc.js';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

/** A wallbox alone: no PV, no battery, no tariff, a charger meter. */
function chargerOnly() {
  const state = structuredClone(fixture('state-0.317.1.json'));
  state.pv = [];
  delete state.pvPower;
  state.battery = { power: 0, soc: null, devices: [] };
  delete state.tariffGrid;
  state.smartCostAvailable = false;
  delete state.smartCostType;
  state.loadpoints = [{ ...state.loadpoints[0], chargeTotalImport: 1234.567 }];
  return state;
}

const installations = [
  { label: 'evcc 0.317.1 demo', state: () => fixture('state-0.317.1.json'), devices: 8 },
  { label: 'evcc 0.210.0 demo', state: () => fixture('state-0.210.0.json'), devices: 8 },
  { label: 'a charger with its meter', state: chargerOnly, devices: 6 },
];

const languages = [undefined, 'en', 'de', 'es'];

for (const installation of installations) {
  for (const language of languages) {
    test(`every discovered device follows the Gladys rules (${installation.label}, ${language ?? 'default language'})`, async () => {
      const server = createEvcc({ state: installation.state() });
      const { gladys, app } = await createWorld({
        evcc: server,
        config: { url: server.url, ...(language ? { language } : {}) },
      });
      try {
        const devices = gladys.fake.discoveredDevices;
        assert.equal(devices.length, installation.devices);
        for (const device of devices) {
          const where = device.name;

          // should_poll: true if and only if poll_frequency is provided, in ms.
          if (device.poll_frequency === undefined) {
            assert.notEqual(
              device.should_poll,
              true,
              `${where}: should_poll without poll_frequency`,
            );
          } else {
            assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
            assert.ok(
              table.poll_frequencies_ms.includes(device.poll_frequency),
              `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
            );
          }

          assert.ok(device.features.length > 0, `${where}: no feature`);
          const externalIds = new Set();
          const names = new Set();
          for (const feature of device.features) {
            const at = `${where} / ${feature.name}`;
            const pair = table.pairs[`${feature.category}/${feature.type}`];
            assert.ok(
              pair,
              `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
            );
            assert.ok(
              pair.label_en && pair.label_fr && pair.icon,
              `${at}: couple without label or icon`,
            );

            assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
            assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
            assert.ok(
              Number.isFinite(feature.min) && Number.isFinite(feature.max),
              `${at}: finite min/max`,
            );
            assert.ok(feature.min <= feature.max, `${at}: min > max`);
            assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
            assert.equal(
              typeof feature.has_feedback,
              'boolean',
              `${at}: has_feedback must be a boolean`,
            );
            if (feature.unit !== undefined) {
              assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
              const allowed = table.units_by_category?.[feature.category];
              if (allowed) {
                assert.ok(
                  allowed.includes(feature.unit),
                  `${at}: unit ${feature.unit} not for ${feature.category}`,
                );
              }
            }

            assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
            externalIds.add(feature.external_id);
            assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
            names.add(feature.name);
          }
        }
      } finally {
        await app.stop();
      }
    });
  }
}
