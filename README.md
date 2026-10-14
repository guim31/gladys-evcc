# evcc for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
brings [evcc](https://evcc.io) — solar surplus charging of electric vehicles —
into Gladys, over the local network, through the evcc REST API and its
websocket. No cloud, no account.

> **Developed without the hardware: feedback welcome.** Everything was
> exercised against `evcc --demo` in Docker (official `evcc/evcc` image,
> versions 0.210.0 and 0.317.1): live updates, mode and limit commands,
> reconnection, evcc stopped and back. It has not run against a real charger
> yet. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-evcc/issues).

## Features

- **Site device**: solar production, home consumption, signed grid exchange,
  home battery (level, charging and discharging power), current grid price.
- **One device per loadpoint**: charging mode (Off, Solar, Min + solar, Fast —
  controllable), charging state, vehicle plugged in, power, current, session
  energy, time remaining, charge limit (controllable), identified vehicle,
  cheap grid charging, and the charger meter as an energy index (Gladys energy
  monitoring: consumption and cost of the charger).
- **One device per vehicle**: battery level and range (while plugged in),
  charge limit (controllable), plugged in, next charging plan.
- **Dashboard widget "evcc"**: energy flow, home battery, grid price, one row
  per loadpoint, and the four mode buttons of a loadpoint.
- **Scene triggers**: vehicle plugged in (once identified), vehicle unplugged,
  charging started, charging finished (with energy, duration and solar share;
  a short solar pause is not the end of a charge), charging mode changed.
- **Scene actions**: set the charging mode, set a charge limit (battery level
  of a loadpoint or a vehicle, energy of a loadpoint).
- Live through the evcc websocket, with a REST fallback; works with the evcc
  versions before and after the 0.317 mode redesign (`pv` → `smart`).
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- evcc reachable from Gladys, 0.200 or later recommended (older versions are
  read as well as possible).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-evcc` (or find **evcc** in the catalog).
2. In **Configuration**, enter the address of evcc (`http://<ip>:7070`), save
   and click **Test the connection**.
3. Add the site, loadpoints and vehicles from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- `GET /api/state` at start and after every loss of the websocket, then the
  websocket `/ws` (one frame per changed key, the first frame holds the whole
  state). While the websocket is down, the state is read every 30 s.
- Commands: `POST /api/loadpoints/{id}/mode|limitsoc|limitenergy/...` and
  `POST /api/vehicles/{name}/limitsoc/...`. When evcc answers 401 and an admin
  password is configured, the integration logs in (`/api/auth/login`) and
  retries once.
- Only changed values reach Gladys (powers rounded to 10 W), at most every
  5 s, and every value is published again every 6 hours.
- Scene events are derived from the successive states of evcc; nothing fires
  from the first state read after a (re)connection.

## Limitations

- One evcc instance per installation.
- Charging plans are read, not created; repeating plans are not shown.
- Phases, currents, home battery control and advanced settings stay in evcc.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + a simulated evcc
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js                  SDK wiring (src/app.js registers the handlers)
src/hub.js                link to evcc, states, connection status, scene events, commands
src/evcc/client.js        REST client (state, commands, admin login)
src/evcc/socket.js        websocket with reconnection and idle watchdog
src/evcc/model.js         evcc state of every version -> snapshot
src/devices.js            snapshot -> Gladys devices and states
src/events.js             charging sessions -> scene events
src/widgets.js            "evcc" dashboard widget
src/scenes.js             scene actions
src/texts.js              every text, in four languages
test/                     node --test; the SDK's fake Gladys, a simulated evcc
test/fixtures/evcc/       real evcc --demo answers (0.210.0, 0.317.1), cleaned
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="evcc" \
EVCC_DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [evcc](https://github.com/evcc-io/evcc) (MIT) and its
  [API documentation](https://docs.evcc.io/en/docs/reference/api): the
  fixtures were recorded on the official `evcc/evcc` image in demo mode. The
  cover uses the evcc logo (`assets/js/components/Footer/Logo.vue` of the evcc
  repository).
- [ha-evcc](https://github.com/marq24/ha-evcc) by marq24 (Apache-2.0), the Home
  Assistant integration for evcc: the handling of the websocket frames and of
  the state of older evcc versions.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the evcc project.
"evcc" is the name of its owners' project.

## License

Apache-2.0
