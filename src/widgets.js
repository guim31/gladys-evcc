// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `evcc`.
//
// The energy flow at a glance (solar, home, grid as tiles), the home battery,
// the grid price and one row per loadpoint (state, power, mode), and the four
// mode buttons of one loadpoint (the widget setting, or the first one). The
// current mode is marked by its icon (check-circle): the `primary` style is
// invisible in dark mode (Gladys#3153).
//
// Budget of the core: 8 components (3 tiles + 1 status + 4 buttons), 2 texts.
// The values are literal (from the last evcc snapshot, no request to evcc):
// they do not need the devices to be added in Gladys. No button opens a form:
// Gladys 5.1 is enough.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { loadpointIds, parseExternalId } from './devices.js';
import { CHARGING_STATE, MODES } from './evcc/model.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { MODE_LABELS, STATE_LABELS, modeSetMessage } from './texts.js';

export { WIDGET_KEY };

export const TEXT = {
  configure: {
    en: 'Enter the address of evcc in the configuration of the integration.',
    fr: "Saisissez l'adresse d'evcc dans la configuration de l'intégration.",
    de: 'Gib die Adresse von evcc in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de evcc en la configuración de la integración.',
  },
  waiting: {
    en: 'Waiting for evcc to answer.',
    fr: "En attente d'une réponse d'evcc.",
    de: 'Warte auf eine Antwort von evcc.',
    es: 'Esperando la respuesta de evcc.',
  },
  unreachable: {
    en: 'evcc does not answer: last known values.',
    fr: 'evcc ne répond pas : dernières valeurs connues.',
    de: 'evcc antwortet nicht: letzte bekannte Werte.',
    es: 'evcc no responde: últimos valores conocidos.',
  },
  solar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  home: { en: 'Home', fr: 'Maison', de: 'Haus', es: 'Casa' },
  grid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  battery: { en: 'Home battery', fr: 'Batterie maison', de: 'Hausbatterie', es: 'Batería casa' },
  price: { en: 'Grid price', fr: 'Prix du réseau', de: 'Netzpreis', es: 'Precio de la red' },
};

const STATE_COLORS = {
  [CHARGING_STATE.CHARGING]: WIDGET_COLORS.SUCCESS,
  [CHARGING_STATE.EV_CONNECTED]: WIDGET_COLORS.NEUTRAL,
  [CHARGING_STATE.PAUSED_BY_VEHICLE]: WIDGET_COLORS.INFO,
  [CHARGING_STATE.PAUSED_BY_CHARGER]: WIDGET_COLORS.WARNING,
  [CHARGING_STATE.IDLE]: WIDGET_COLORS.NEUTRAL,
};

const MODE_ICONS = { off: 'power', pv: 'sun', minpv: 'sunrise', now: 'zap' };
const CURRENCY_SIGNS = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };

export const WIDGET_ACTIONS = MODES.map((mode) => `mode_${mode}`);

const pick = (table, language) => table[language] ?? table.en;
const textOnly = (text, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text }],
});
const kw = (watts) => Math.round(watts / 100) / 10;

/** Number with a dot or a comma, as the language writes it. */
function decimal(value, digits, language) {
  const fixed = value.toFixed(digits);
  return language === 'en' ? fixed : fixed.replace('.', ',');
}

/** The loadpoint the buttons drive: the widget setting, else the first one. */
function targetLoadpoint(hub, settings) {
  const loadpoints = hub.snapshot?.loadpoints ?? [];
  const parsed = parseExternalId(hub.gladys, settings.device);
  if (parsed?.kind === 'loadpoint') {
    const chosen = loadpoints.find((lp) => String(lp.id) === parsed.id);
    if (chosen) {
      return chosen;
    }
  }
  return loadpoints[0] ?? null;
}

/**
 * The widget content.
 * @param {object} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function buildContent(hub, { settings = {}, language = 'en' }) {
  const lang = MODE_LABELS[language] ? language : 'en';
  if (!hub.config.url) {
    return textOnly(pick(TEXT.configure, lang), 300);
  }
  const snapshot = hub.snapshot;
  if (!snapshot) {
    return textOnly(pick(TEXT.waiting, lang), 30);
  }
  const online = hub.status === 'online';
  const { site } = snapshot;
  const structure = hub.structure?.site ?? {};
  const components = [];
  if (!online) {
    components.push({ type: 'text', variant: 'caption', text: pick(TEXT.unreachable, lang) });
  }

  if (structure.hasPv && site.pvPower !== null) {
    components.push({
      type: 'value',
      label: pick(TEXT.solar, lang),
      value: kw(site.pvPower),
      unit: 'kW',
      icon: 'sun',
      color: site.pvPower > 50 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (site.homePower !== null) {
    components.push({
      type: 'value',
      label: pick(TEXT.home, lang),
      value: kw(site.homePower),
      unit: 'kW',
      icon: 'home',
    });
  }
  if (structure.hasGrid && site.gridPower !== null) {
    components.push({
      type: 'value',
      label: pick(TEXT.grid, lang),
      value: kw(site.gridPower),
      unit: 'kW',
      icon: 'zap',
      // Exporting (negative) is the surplus evcc charges with.
      color: site.gridPower < -50 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }

  const items = [];
  if (structure.hasBattery && site.batterySoc !== null) {
    const power = site.batteryPower ?? 0;
    items.push({
      label: pick(TEXT.battery, lang),
      value:
        Math.abs(power) >= 50
          ? `${Math.round(site.batterySoc)} % · ${power < 0 ? '+' : '−'}${decimal(Math.abs(power) / 1000, 1, lang)} kW`
          : `${Math.round(site.batterySoc)} %`,
      icon: power < -50 ? 'battery-charging' : 'battery',
    });
  }
  if (structure.hasPrice && site.gridPrice !== null) {
    const sign = CURRENCY_SIGNS[site.currency] ?? site.currency;
    items.push({
      label: pick(TEXT.price, lang),
      value: `${decimal(site.gridPrice, 3, lang)} ${sign}/kWh`,
      icon: 'tag',
    });
  }
  const states = STATE_LABELS[lang];
  const modes = MODE_LABELS[lang];
  for (const lp of snapshot.loadpoints.slice(0, 10 - items.length)) {
    const parts = [states[lp.chargingState]];
    if (lp.charging && lp.chargePower !== null) {
      parts.push(`${decimal(lp.chargePower / 1000, 1, lang)} kW`);
    }
    if (lp.mode) {
      parts.push(modes[lp.mode]);
    }
    items.push({
      label: lp.title.slice(0, 40),
      value: parts.join(' · ').slice(0, 40),
      color: STATE_COLORS[lp.chargingState],
      icon: lp.integrated ? 'thermometer' : 'battery-charging',
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }

  const target = online ? targetLoadpoint(hub, settings) : null;
  if (target) {
    for (const mode of MODES) {
      components.push({
        type: 'button',
        label: modes[mode],
        icon: target.mode === mode ? 'check-circle' : MODE_ICONS[mode],
        action: { key: `mode_${mode}`, params: { loadpoint: target.id } },
      });
    }
  }

  return { ttl_seconds: 30, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (the widget action receives no language: all four). */
    async action(hub, { actionKey, params = {} }) {
      const mode = typeof actionKey === 'string' ? actionKey.replace(/^mode_/, '') : '';
      if (!WIDGET_ACTIONS.includes(actionKey)) {
        throw new Error(`Unknown widget action ${actionKey}`);
      }
      const device = loadpointIds(hub.gladys, params.loadpoint).device;
      try {
        const loadpoint = await hub.setMode(device, mode);
        return modeSetMessage(loadpoint.title, mode);
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
    },
  },
};
