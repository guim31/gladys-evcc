# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-14

### Added

- First version of the evcc integration (Gladys 5.1 or later), local only.
- Site device: solar production, home consumption, grid exchange, home battery,
  grid price.
- One device per loadpoint: charging mode and charge limit (controllable),
  charging state, vehicle plugged in, power, current, session energy, time
  remaining, vehicle, cheap grid charging, charger meter for the energy
  monitoring.
- One device per vehicle: battery level, range, charge limit (controllable),
  plugged in, charging plan.
- Dashboard widget "evcc": energy flow, loadpoints and mode buttons.
- Scene triggers: vehicle plugged in, vehicle unplugged, charging started,
  charging finished, charging mode changed.
- Scene actions: set the charging mode, set a charge limit.
- Live updates through the evcc websocket, REST fallback, optional admin
  password, evcc versions before and after 0.317.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-evcc/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-evcc/releases/tag/v1.0.0
