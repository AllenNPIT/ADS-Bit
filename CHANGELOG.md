# Changelog

All notable changes to this project are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-06-10

### Added
- `/health` endpoint (status, version, receiver/flight counts) plus a Docker
  `HEALTHCHECK`.
- `ADSBIT_CONFIG` environment variable to override the config file path.

### Changed
- Docker first-run now works with no manual steps: `config.json` is auto-seeded
  from `config.json.example` by `docker-entrypoint.sh` and persisted on a
  `./data` directory mount (removing the single-file bind-mount footgun).
- Network auto-scan skips subnets larger than `/20` (e.g. a Docker bridge
  `172.17.0.0/16`) so discovery no longer stalls startup on Docker hosts.
- `SIGTERM`/`SIGINT` (`docker stop`, `systemctl stop`) shut down cleanly
  without a stack trace.

## [1.1.0] - 2026-06-09

### Added
- In-app pixel editor for sprites (admin → Sprites → EDIT): pencil, eraser,
  color picker, fill bucket, line/rectangle/ellipse shapes, rectangular
  select with move/cut/copy/paste, reference-image overlay, brush size &
  opacity, custom + recent palettes, zoom/pan, grid, undo/redo.
- Receiver health dashboard: live per-receiver status (receiving / no data /
  unreachable), connection testing, a select → save → apply flow, selectable
  scan results, and a per-interface scan selector.
- Version surfaced at startup, via `GET /api/config`, and in the admin header.

### Fixed
- Server crash when restarting receiver connections: cancelled receiver tasks
  no longer tear down the main event loop.

## [1.0] - 2026-01

### Added
- Initial release: retro SNES-style side-view ADS-B flight tracker with custom
  pixel-art sprites, directional backgrounds, weather, sun/moon, admin panel,
  first-run setup wizard, and Docker/Podman support.

[1.1.1]: https://github.com/AllenNPIT/ADS-Bit/releases/tag/v1.1.1
[1.1.0]: https://github.com/AllenNPIT/ADS-Bit/releases/tag/v1.1.0
[1.0]: https://github.com/AllenNPIT/ADS-Bit/releases/tag/v1.0
