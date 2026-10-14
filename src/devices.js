// -----------------------------------------------------------------------------
// evcc snapshot -> Gladys devices and feature states. Three kinds of device:
//
// - the site (`site:main`): solar production, home consumption, grid
//   exchange, home battery, grid price — only what evcc measures;
// - one device per loadpoint (`loadpoint:<id>`, the id of evcc's API, from 1):
//   mode (controllable), plugged in, charging state, power, session energy,
//   time remaining, charge limit (controllable), vehicle, cheap charging,
//   and the charger meter (an energy index Gladys turns into consumption);
// - one device per vehicle of evcc (`vehicle:<name>`): battery level and
//   range (known while it is plugged in), charge limit (controllable),
//   plugged in, charging plan.
//
// Couples, all known by the Gladys 5.1 front (test/gladys-rules.test.js):
// - signed grid exchange: grid-sensor/power, symmetric bounds (gauge);
// - the home battery has no signed power couple: charge-power and
//   discharge-power, both >= 0 (evcc: positive = discharging);
// - charging state: charging-station/charging-state (OCPP enumeration the
//   front translates: 0 charging, 1 plugged in, 2 paused by the vehicle,
//   3 paused by the charger, 4 idle);
// - mode: text/select with stable values off, pv, minpv, now;
// - charger meter: energy-sensor/index, the only couple the Gladys energy
//   module derives into consumption and cost (a charger is a sub-meter of
//   the house: no double counting).
//
// Feature keys are forever: `limit_soc`, never renamed.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { MODES, loadpointOfVehicle } from './evcc/model.js';
import { MODE_LABELS, NAMES, NO_VEHICLE, planText } from './texts.js';

export const SITE_ID = 'main';
const MAX_POWER_W = 100_000;
export const LIMIT_SOC = { min: 0, max: 100 };

const CURRENCY_UNITS = {
  EUR: UNIT.EURO,
  USD: UNIT.DOLLAR,
  GBP: UNIT.POUND_STERLING,
};

export const siteIds = (gladys) => gladys.externalIds('site', SITE_ID);
export const loadpointIds = (gladys, id) => gladys.externalIds('loadpoint', String(id));

/** evcc vehicle name (`vehicle_1`, `db:3`) -> the platform id of its device. */
export const vehicleKey = (name) => name.replace(/[^A-Za-z0-9_-]/g, '-');
export const vehicleIds = (gladys, name) => gladys.externalIds('vehicle', vehicleKey(name));

/**
 * What the devices are made of: the structure of a snapshot. Merged with the
 * structure known from a previous run (src/store.js), so a feature seen once
 * stays (no flickering structure when a meter misses one reading).
 */
export function structureOf(snapshot, known = {}) {
  const site = snapshot.site;
  const knownSite = known.site ?? {};
  const knownLoadpoints = new Map((known.loadpoints ?? []).map((lp) => [lp.id, lp]));
  const knownVehicles = new Map((known.vehicles ?? []).map((v) => [v.name, v]));
  return {
    site: {
      title: site.title ?? knownSite.title ?? null,
      hasPv: Boolean(site.hasPv || knownSite.hasPv),
      hasGrid: Boolean(site.hasGrid || knownSite.hasGrid),
      hasBattery: Boolean(site.hasBattery || knownSite.hasBattery),
      hasPrice: Boolean(site.gridPrice !== null || knownSite.hasPrice),
      hasSmartCost: Boolean(site.hasSmartCost || knownSite.hasSmartCost),
      currency: site.currency ?? knownSite.currency ?? 'EUR',
    },
    loadpoints: snapshot.loadpoints.map((lp) => {
      const before = knownLoadpoints.get(lp.id) ?? {};
      return {
        id: lp.id,
        title: lp.title,
        integrated: lp.integrated,
        hasTotal: Boolean(lp.totalImport !== null || before.hasTotal),
      };
    }),
    vehicles: snapshot.vehicles.map((vehicle) => ({
      name: vehicle.name,
      title: vehicle.title ?? knownVehicles.get(vehicle.name)?.title ?? vehicle.name,
    })),
  };
}

function featureFactory(ids) {
  return (key, name, fields) => ({
    name,
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    ...fields,
  });
}

const watts = (category, type, min = 0) => ({
  category,
  type,
  unit: UNIT.WATT,
  min,
  max: MAX_POWER_W,
});

export function buildSiteDevice(gladys, site, language) {
  const names = NAMES[language] ?? NAMES.en;
  const feature = featureFactory(siteIds(gladys));
  const features = [];
  if (site.hasPv) {
    features.push(
      feature(
        'pv_power',
        names.pv_power,
        watts(CAT.ENERGY_PRODUCTION_SENSOR, TYPE.ENERGY_PRODUCTION_SENSOR.POWER),
      ),
    );
  }
  features.push(
    feature('home_power', names.home_power, watts(CAT.ENERGY_SENSOR, TYPE.ENERGY_SENSOR.POWER)),
  );
  if (site.hasGrid) {
    features.push(
      feature(
        'grid_power',
        names.grid_power,
        watts(CAT.GRID_SENSOR, TYPE.GRID_SENSOR.POWER, -MAX_POWER_W),
      ),
    );
  }
  if (site.hasBattery) {
    features.push(
      feature('battery_level', names.battery_level, {
        category: CAT.BATTERY_STORAGE,
        type: TYPE.BATTERY_STORAGE.BATTERY_LEVEL,
        unit: UNIT.PERCENT,
        min: 0,
        max: 100,
      }),
      feature(
        'battery_charge_power',
        names.battery_charge_power,
        watts(CAT.BATTERY_STORAGE, TYPE.BATTERY_STORAGE.CHARGE_POWER),
      ),
      feature(
        'battery_discharge_power',
        names.battery_discharge_power,
        watts(CAT.BATTERY_STORAGE, TYPE.BATTERY_STORAGE.DISCHARGE_POWER),
      ),
    );
  }
  if (site.hasPrice) {
    const unit = CURRENCY_UNITS[site.currency];
    features.push(
      feature('grid_price', names.grid_price, {
        category: CAT.CURRENCY,
        type: TYPE.CURRENCY.DECIMAL,
        ...(unit ? { unit } : {}),
        // Dynamic tariffs go negative.
        min: -10,
        max: 10,
      }),
    );
  }
  return {
    name: (site.title ?? 'evcc').slice(0, 60),
    external_id: siteIds(gladys).device,
    model: 'evcc',
    should_poll: false,
    features,
  };
}

export function modeOptions(language) {
  const labels = MODE_LABELS[language] ?? MODE_LABELS.en;
  return MODES.map((value, index) => ({ value, label: labels[value], sort_order: index }));
}

export function buildLoadpointDevice(gladys, loadpoint, site, language) {
  const names = NAMES[language] ?? NAMES.en;
  const feature = featureFactory(loadpointIds(gladys, loadpoint.id));
  const features = [
    feature('mode', names.mode, {
      category: CAT.TEXT,
      type: TYPE.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      supported_options: modeOptions(language),
    }),
    feature('charging_state', names.charging_state, {
      category: CAT.CHARGING_STATION,
      type: TYPE.CHARGING_STATION.CHARGING_STATE,
      min: 0,
      max: 5,
    }),
    feature('charge_power', names.charge_power, {
      category: CAT.ELECTRICAL_VEHICLE_CHARGE,
      type: TYPE.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
      unit: UNIT.KILOWATT,
      min: 0,
      max: 350,
    }),
    feature('session_energy', names.session_energy, {
      category: CAT.ELECTRICAL_VEHICLE_CHARGE,
      type: TYPE.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
      unit: UNIT.KILOWATT_HOUR,
      min: 0,
      max: 1000,
    }),
  ];
  if (!loadpoint.integrated) {
    features.push(
      feature('plugged', names.plugged, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
        min: 0,
        max: 1,
      }),
      feature('charge_current', names.charge_current, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.CHARGE_CURRENT,
        unit: UNIT.AMPERE,
        min: 0,
        max: 100,
      }),
      feature('remaining_time', names.remaining_time, {
        category: CAT.DURATION,
        type: TYPE.DURATION.INTEGER,
        unit: UNIT.MINUTES,
        min: 0,
        max: 100_000,
      }),
      feature('limit_soc', names.limit_soc, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.TARGET_CHARGE_LIMIT,
        unit: UNIT.PERCENT,
        min: LIMIT_SOC.min,
        max: LIMIT_SOC.max,
        read_only: false,
        has_feedback: true,
      }),
      feature('vehicle', names.vehicle, {
        category: CAT.TEXT,
        type: TYPE.TEXT.TEXT,
        min: 0,
        max: 0,
      }),
    );
  }
  if (site.hasSmartCost) {
    features.push(
      feature('smart_cost', names.smart_cost, {
        category: CAT.INPUT,
        type: TYPE.INPUT.BINARY,
        min: 0,
        max: 1,
      }),
    );
  }
  if (loadpoint.hasTotal) {
    features.push(
      feature('total_energy', names.total_energy, {
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.INDEX,
        unit: UNIT.KILOWATT_HOUR,
        min: 0,
        max: 10_000_000,
      }),
    );
  }
  return {
    name: loadpoint.title.slice(0, 60),
    external_id: loadpointIds(gladys, loadpoint.id).device,
    model: 'evcc loadpoint',
    should_poll: false,
    features,
    params: [{ name: 'EVCC_LOADPOINT', value: String(loadpoint.id) }],
  };
}

export function buildVehicleDevice(gladys, vehicle, language) {
  const names = NAMES[language] ?? NAMES.en;
  const feature = featureFactory(vehicleIds(gladys, vehicle.name));
  return {
    name: vehicle.title.slice(0, 60),
    external_id: vehicleIds(gladys, vehicle.name).device,
    model: 'evcc vehicle',
    should_poll: false,
    features: [
      feature('soc', names.soc, {
        category: CAT.ELECTRICAL_VEHICLE_BATTERY,
        type: TYPE.ELECTRICAL_VEHICLE_BATTERY.BATTERY_LEVEL,
        unit: UNIT.PERCENT,
        min: 0,
        max: 100,
      }),
      feature('range', names.range, {
        category: CAT.ELECTRICAL_VEHICLE_BATTERY,
        type: TYPE.ELECTRICAL_VEHICLE_BATTERY.BATTERY_RANGE_ESTIMATE,
        unit: UNIT.KM,
        min: 0,
        max: 2000,
      }),
      feature('limit_soc', names.limit_soc, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.TARGET_CHARGE_LIMIT,
        unit: UNIT.PERCENT,
        min: LIMIT_SOC.min,
        max: LIMIT_SOC.max,
        read_only: false,
        has_feedback: true,
      }),
      feature('plugged', names.plugged, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
        min: 0,
        max: 1,
      }),
      feature('plan', names.plan, {
        category: CAT.TEXT,
        type: TYPE.TEXT.TEXT,
        min: 0,
        max: 0,
      }),
    ],
    params: [{ name: 'EVCC_VEHICLE', value: vehicle.name }],
  };
}

/** Every device of a structure. */
export function buildDevices(gladys, structure, language) {
  return [
    buildSiteDevice(gladys, structure.site, language),
    ...structure.loadpoints.map((lp) => buildLoadpointDevice(gladys, lp, structure.site, language)),
    ...structure.vehicles.map((vehicle) => buildVehicleDevice(gladys, vehicle, language)),
  ];
}

// Powers to 10 W: evcc reads its meters every cycle, and every state Gladys
// receives is stored.
const roundPower = (watts) => (watts === null ? null : Math.round(watts / 10) * 10);
const round = (value, digits) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Feature states of a snapshot, in the publishStates format. Unknown values
 * are left out (Gladys keeps the last one).
 */
export function buildStates(gladys, snapshot, structure, language) {
  const states = [];
  const adder = (ids) => ({
    value: (key, value) => {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        states.push({ device_feature_external_id: ids.feature(key), state: value });
      }
    },
    text: (key, value) => {
      if (typeof value === 'string' && value !== '') {
        states.push({ device_feature_external_id: ids.feature(key), text: value.slice(0, 200) });
      }
    },
  });

  const { site } = snapshot;
  const s = adder(siteIds(gladys));
  if (structure.site.hasPv) {
    s.value('pv_power', roundPower(site.pvPower));
  }
  s.value('home_power', roundPower(site.homePower));
  if (structure.site.hasGrid) {
    s.value('grid_power', roundPower(site.gridPower));
  }
  if (structure.site.hasBattery) {
    s.value('battery_level', site.batterySoc === null ? null : Math.round(site.batterySoc));
    if (site.batteryPower !== null) {
      s.value('battery_charge_power', roundPower(Math.max(0, -site.batteryPower)));
      s.value('battery_discharge_power', roundPower(Math.max(0, site.batteryPower)));
    }
  }
  if (structure.site.hasPrice) {
    s.value('grid_price', round(site.gridPrice, 4));
  }

  const noVehicle = NO_VEHICLE[language] ?? NO_VEHICLE.en;
  for (const shape of structure.loadpoints) {
    const lp = snapshot.loadpoints.find((candidate) => candidate.id === shape.id);
    if (!lp) {
      continue;
    }
    const l = adder(loadpointIds(gladys, lp.id));
    l.text('mode', lp.mode ?? undefined);
    l.value('charging_state', lp.chargingState);
    l.value('charge_power', lp.chargePower === null ? null : round(lp.chargePower / 1000, 2));
    l.value('session_energy', lp.sessionEnergy === null ? null : round(lp.sessionEnergy / 1000, 2));
    if (!shape.integrated) {
      l.value('plugged', lp.connected ? 1 : 0);
      l.value('charge_current', lp.charging ? round(lp.offeredCurrent, 1) : 0);
      l.value(
        'remaining_time',
        lp.charging && lp.remainingDuration !== null ? Math.round(lp.remainingDuration / 60) : 0,
      );
      l.value('limit_soc', lp.effectiveLimitSoc ?? lp.limitSoc);
      l.text('vehicle', lp.connected ? (lp.vehicleTitle ?? noVehicle) : noVehicle);
    }
    if (structure.site.hasSmartCost && lp.smartCostActive !== null) {
      l.value('smart_cost', lp.smartCostActive ? 1 : 0);
    }
    if (shape.hasTotal) {
      l.value('total_energy', round(lp.totalImport, 3));
    }
  }

  for (const shape of structure.vehicles) {
    const vehicle = snapshot.vehicles.find((candidate) => candidate.name === shape.name);
    if (!vehicle) {
      continue;
    }
    const v = adder(vehicleIds(gladys, vehicle.name));
    const at = loadpointOfVehicle(snapshot, vehicle.name);
    if (at) {
      // evcc reads the car only while it is plugged in: the last value stays.
      v.value('soc', at.vehicleSoc === null ? null : Math.round(at.vehicleSoc));
      v.value('range', at.vehicleRange === null ? null : Math.round(at.vehicleRange));
    }
    // No limit set in evcc: the car charges to 100 %.
    v.value('limit_soc', vehicle.limitSoc && vehicle.limitSoc > 0 ? vehicle.limitSoc : 100);
    v.value('plugged', at ? 1 : 0);
    v.text('plan', planText(vehicle.planTime, vehicle.planSoc, language));
  }
  return states;
}

/** `ext:...:loadpoint:2` -> { kind: 'loadpoint', id: '2' }, or null. */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const kind of ['site', 'loadpoint', 'vehicle']) {
    const prefix = gladys.externalId(`${kind}:`);
    if (externalId.startsWith(prefix)) {
      const [id, feature] = externalId.slice(prefix.length).split(':');
      return id ? { kind, id, feature: feature ?? null } : null;
    }
  }
  return null;
}
