// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface (German says "du", Spanish "usted"). Feature names follow the
// `language` setting: Gladys does not tell a device integration the user's
// language, and the names are frozen once the device is added.
// -----------------------------------------------------------------------------

import { CHARGING_STATE } from './evcc/model.js';

export const NAMES = {
  en: {
    pv_power: 'Solar production',
    home_power: 'Home consumption',
    grid_power: 'Grid',
    battery_level: 'Home battery',
    battery_charge_power: 'Battery charging',
    battery_discharge_power: 'Battery discharging',
    grid_price: 'Grid price',
    mode: 'Mode',
    plugged: 'Vehicle plugged in',
    charging_state: 'Charging state',
    charge_power: 'Charging power',
    charge_current: 'Charging current',
    session_energy: 'Session energy',
    remaining_time: 'Time remaining',
    limit_soc: 'Charge limit',
    vehicle: 'Vehicle',
    smart_cost: 'Cheap grid charging',
    total_energy: 'Charger meter',
    soc: 'Battery level',
    range: 'Range',
    plan: 'Charging plan',
  },
  fr: {
    pv_power: 'Production solaire',
    home_power: 'Consommation maison',
    grid_power: 'Réseau',
    battery_level: 'Batterie maison',
    battery_charge_power: 'Charge batterie',
    battery_discharge_power: 'Décharge batterie',
    grid_price: 'Prix du réseau',
    mode: 'Mode',
    plugged: 'Véhicule branché',
    charging_state: 'État de la charge',
    charge_power: 'Puissance de charge',
    charge_current: 'Intensité de charge',
    session_energy: 'Énergie de la session',
    remaining_time: 'Temps restant',
    limit_soc: 'Limite de charge',
    vehicle: 'Véhicule',
    smart_cost: 'Charge au prix bas',
    total_energy: 'Compteur de la borne',
    soc: 'Niveau de batterie',
    range: 'Autonomie',
    plan: 'Plan de charge',
  },
  de: {
    pv_power: 'Solarproduktion',
    home_power: 'Hausverbrauch',
    grid_power: 'Netz',
    battery_level: 'Hausbatterie',
    battery_charge_power: 'Batterie lädt',
    battery_discharge_power: 'Batterie entlädt',
    grid_price: 'Netzpreis',
    mode: 'Modus',
    plugged: 'Fahrzeug angesteckt',
    charging_state: 'Ladezustand',
    charge_power: 'Ladeleistung',
    charge_current: 'Ladestrom',
    session_energy: 'Energie des Ladevorgangs',
    remaining_time: 'Restzeit',
    limit_soc: 'Ladelimit',
    vehicle: 'Fahrzeug',
    smart_cost: 'Günstiges Netzladen',
    total_energy: 'Zähler der Wallbox',
    soc: 'Batteriestand',
    range: 'Reichweite',
    plan: 'Ladeplan',
  },
  es: {
    pv_power: 'Producción solar',
    home_power: 'Consumo de la casa',
    grid_power: 'Red',
    battery_level: 'Batería de la casa',
    battery_charge_power: 'Carga de la batería',
    battery_discharge_power: 'Descarga de la batería',
    grid_price: 'Precio de la red',
    mode: 'Modo',
    plugged: 'Vehículo conectado',
    charging_state: 'Estado de la carga',
    charge_power: 'Potencia de carga',
    charge_current: 'Corriente de carga',
    session_energy: 'Energía de la sesión',
    remaining_time: 'Tiempo restante',
    limit_soc: 'Límite de carga',
    vehicle: 'Vehículo',
    smart_cost: 'Carga a precio bajo',
    total_energy: 'Contador del cargador',
    soc: 'Nivel de batería',
    range: 'Autonomía',
    plan: 'Plan de carga',
  },
};

// The four modes, as evcc's own interface names them (`pv` is "Smart" since
// evcc 0.317: said in the documentation).
export const MODE_LABELS = {
  en: { off: 'Off', pv: 'Solar', minpv: 'Min + solar', now: 'Fast' },
  fr: { off: 'Arrêt', pv: 'Solaire', minpv: 'Min + solaire', now: 'Rapide' },
  de: { off: 'Aus', pv: 'PV', minpv: 'Min + PV', now: 'Schnell' },
  es: { off: 'Apagado', pv: 'Solar', minpv: 'Mín + solar', now: 'Rápido' },
};

// Short labels of a loadpoint state, for the widget (Gladys translates the
// feature itself).
export const STATE_LABELS = {
  en: {
    [CHARGING_STATE.CHARGING]: 'Charging',
    [CHARGING_STATE.EV_CONNECTED]: 'Plugged in',
    [CHARGING_STATE.PAUSED_BY_VEHICLE]: 'Paused (vehicle)',
    [CHARGING_STATE.PAUSED_BY_CHARGER]: 'Waiting',
    [CHARGING_STATE.IDLE]: 'Free',
  },
  fr: {
    [CHARGING_STATE.CHARGING]: 'En charge',
    [CHARGING_STATE.EV_CONNECTED]: 'Branché',
    [CHARGING_STATE.PAUSED_BY_VEHICLE]: 'Pause (véhicule)',
    [CHARGING_STATE.PAUSED_BY_CHARGER]: 'En attente',
    [CHARGING_STATE.IDLE]: 'Libre',
  },
  de: {
    [CHARGING_STATE.CHARGING]: 'Lädt',
    [CHARGING_STATE.EV_CONNECTED]: 'Angesteckt',
    [CHARGING_STATE.PAUSED_BY_VEHICLE]: 'Pause (Fahrzeug)',
    [CHARGING_STATE.PAUSED_BY_CHARGER]: 'Wartet',
    [CHARGING_STATE.IDLE]: 'Frei',
  },
  es: {
    [CHARGING_STATE.CHARGING]: 'Cargando',
    [CHARGING_STATE.EV_CONNECTED]: 'Conectado',
    [CHARGING_STATE.PAUSED_BY_VEHICLE]: 'Pausa (vehículo)',
    [CHARGING_STATE.PAUSED_BY_CHARGER]: 'En espera',
    [CHARGING_STATE.IDLE]: 'Libre',
  },
};

export const NO_VEHICLE = {
  en: 'No vehicle',
  fr: 'Aucun véhicule',
  de: 'Kein Fahrzeug',
  es: 'Ningún vehículo',
};

export const NO_PLAN = {
  en: 'No plan',
  fr: 'Aucun plan',
  de: 'Kein Plan',
  es: 'Ningún plan',
};

const PLAN = {
  en: (soc, date) => `${soc} % by ${date}`,
  fr: (soc, date) => `${soc} % pour ${date}`,
  de: (soc, date) => `${soc} % bis ${date}`,
  es: (soc, date) => `${soc} % para ${date}`,
};

/** "80 % pour mer. 15 oct. 07:00", in the time zone of Gladys (TZ). */
export function planText(time, soc, language) {
  if (time === null || time === undefined) {
    return (NO_PLAN[language] ?? NO_PLAN.en).slice(0, 40);
  }
  let date;
  try {
    date = new Date(time).toLocaleString(language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    date = new Date(time).toISOString().slice(0, 16).replace('T', ' ');
  }
  const render = PLAN[language] ?? PLAN.en;
  return (soc ? render(Math.round(soc), date) : date).slice(0, 40);
}

// Connection status of the integration (Gladys shows it on its page).
export const STATUS_TEXT = {
  en: {
    none: 'Enter the address of evcc in the configuration.',
    invalid: 'The address of evcc is not valid: enter it like http://192.168.1.20:7070.',
    unreachable: 'evcc does not answer at the configured address.',
    unauthorized: 'evcc asks for its admin password: enter it in the configuration.',
    invalidAnswer: 'The configured address does not answer like evcc.',
  },
  fr: {
    none: "Saisissez l'adresse d'evcc dans la configuration.",
    invalid: "L'adresse d'evcc n'est pas valide : saisissez-la comme http://192.168.1.20:7070.",
    unreachable: "evcc ne répond pas à l'adresse configurée.",
    unauthorized:
      'evcc demande son mot de passe administrateur : saisissez-le dans la configuration.',
    invalidAnswer: "L'adresse configurée ne répond pas comme evcc.",
  },
  de: {
    none: 'Gib die Adresse von evcc in der Konfiguration ein.',
    invalid: 'Die Adresse von evcc ist ungültig: gib sie wie http://192.168.1.20:7070 ein.',
    unreachable: 'evcc antwortet nicht unter der eingestellten Adresse.',
    unauthorized: 'evcc verlangt sein Admin-Passwort: gib es in der Konfiguration ein.',
    invalidAnswer: 'Die eingestellte Adresse antwortet nicht wie evcc.',
  },
  es: {
    none: 'Introduzca la dirección de evcc en la configuración.',
    invalid: 'La dirección de evcc no es válida: introdúzcala como http://192.168.1.20:7070.',
    unreachable: 'evcc no responde en la dirección configurada.',
    unauthorized: 'evcc pide su contraseña de administrador: introdúzcala en la configuración.',
    invalidAnswer: 'La dirección configurada no responde como evcc.',
  },
};

export const INIT_FAILED = {
  en: 'The evcc integration could not start: see its logs.',
  fr: "L'intégration evcc n'a pas pu démarrer : consultez ses journaux.",
  de: 'Die evcc-Integration konnte nicht starten: sieh in ihre Protokolle.',
  es: 'La integración evcc no pudo iniciarse: consulte sus registros.',
};

// Refused commands (thrown to Gladys, returned as widget toasts).
export const COMMAND_ERRORS = {
  en: {
    unknown_device: 'This device is not an evcc loadpoint or vehicle known by the integration.',
    not_loadpoint: 'Choose an evcc loadpoint for this action.',
    unreachable: 'evcc does not answer: the command was not sent.',
    unauthorized: 'evcc refused the command: check its admin password in the configuration.',
    refused: 'evcc refused the command.',
    invalid_mode: 'Unknown charging mode.',
    out_of_range: (min, max, unit) => `The value must be between ${min} and ${max} ${unit}.`,
    vehicle_energy: 'An energy limit applies to a loadpoint, not to a vehicle.',
  },
  fr: {
    unknown_device: "Cet appareil n'est pas un point de charge ou un véhicule evcc connu.",
    not_loadpoint: 'Choisissez un point de charge evcc pour cette action.',
    unreachable: "evcc ne répond pas : la commande n'a pas été envoyée.",
    unauthorized:
      'evcc a refusé la commande : vérifiez son mot de passe administrateur dans la configuration.',
    refused: 'evcc a refusé la commande.',
    invalid_mode: 'Mode de charge inconnu.',
    out_of_range: (min, max, unit) =>
      `La valeur doit être comprise entre ${min} et ${max} ${unit}.`,
    vehicle_energy: "Une limite d'énergie s'applique à un point de charge, pas à un véhicule.",
  },
  de: {
    unknown_device: 'Dieses Gerät ist kein bekannter evcc-Ladepunkt und kein bekanntes Fahrzeug.',
    not_loadpoint: 'Wähle einen evcc-Ladepunkt für diese Aktion.',
    unreachable: 'evcc antwortet nicht: der Befehl wurde nicht gesendet.',
    unauthorized: 'evcc hat den Befehl abgelehnt: prüfe sein Admin-Passwort in der Konfiguration.',
    refused: 'evcc hat den Befehl abgelehnt.',
    invalid_mode: 'Unbekannter Lademodus.',
    out_of_range: (min, max, unit) => `Der Wert muss zwischen ${min} und ${max} ${unit} liegen.`,
    vehicle_energy: 'Ein Energielimit gilt für einen Ladepunkt, nicht für ein Fahrzeug.',
  },
  es: {
    unknown_device: 'Este dispositivo no es un punto de carga ni un vehículo evcc conocido.',
    not_loadpoint: 'Elija un punto de carga evcc para esta acción.',
    unreachable: 'evcc no responde: el comando no se envió.',
    unauthorized:
      'evcc rechazó el comando: compruebe su contraseña de administrador en la configuración.',
    refused: 'evcc rechazó el comando.',
    invalid_mode: 'Modo de carga desconocido.',
    out_of_range: (min, max, unit) => `El valor debe estar entre ${min} y ${max} ${unit}.`,
    vehicle_energy: 'Un límite de energía se aplica a un punto de carga, no a un vehículo.',
  },
};

/** The multi-language message of a coded refusal. */
export function commandMessage(code, ...args) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => {
      const entry = table[code] ?? table.refused;
      return [language, typeof entry === 'function' ? entry(...args) : entry];
    }),
  );
}

const MODE_SET = {
  en: (loadpoint, mode) => `${loadpoint}: mode ${mode}.`,
  fr: (loadpoint, mode) => `${loadpoint} : mode ${mode}.`,
  de: (loadpoint, mode) => `${loadpoint}: Modus ${mode}.`,
  es: (loadpoint, mode) => `${loadpoint}: modo ${mode}.`,
};

/** Toast of a widget mode button, in the four languages. */
export function modeSetMessage(loadpoint, mode) {
  return Object.fromEntries(
    Object.entries(MODE_SET).map(([language, render]) => [
      language,
      render(loadpoint, MODE_LABELS[language][mode]).slice(0, 200),
    ]),
  );
}

// "Test the connection" (manifest action).
export const TEST_TEXT = {
  en: {
    ok: (version, loadpoints, vehicles) =>
      `evcc ${version} answers: ${loadpoints} loadpoint(s), ${vehicles} vehicle(s).`,
    failed: 'evcc does not answer at the configured address.',
    none: 'Enter and save the address of evcc first.',
  },
  fr: {
    ok: (version, loadpoints, vehicles) =>
      `evcc ${version} répond : ${loadpoints} point(s) de charge, ${vehicles} véhicule(s).`,
    failed: "evcc ne répond pas à l'adresse configurée.",
    none: "Saisissez et enregistrez d'abord l'adresse d'evcc.",
  },
  de: {
    ok: (version, loadpoints, vehicles) =>
      `evcc ${version} antwortet: ${loadpoints} Ladepunkt(e), ${vehicles} Fahrzeug(e).`,
    failed: 'evcc antwortet nicht unter der eingestellten Adresse.',
    none: 'Gib zuerst die Adresse von evcc ein und speichere sie.',
  },
  es: {
    ok: (version, loadpoints, vehicles) =>
      `evcc ${version} responde: ${loadpoints} punto(s) de carga, ${vehicles} vehículo(s).`,
    failed: 'evcc no responde en la dirección configurada.',
    none: 'Introduzca y guarde primero la dirección de evcc.',
  },
};
