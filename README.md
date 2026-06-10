# ADS-Bit

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/OWNER/ADS-Bit)](https://github.com/OWNER/ADS-Bit/releases)
[![CI](https://github.com/OWNER/ADS-Bit/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/ADS-Bit/actions/workflows/ci.yml)

> **Setup note:** replace `OWNER` with your GitHub username/org throughout this README (badges and image names) after creating the repository.

A retro SNES-style side-view flight tracker that displays ADS-B aircraft data with custom pixel art sprites.

![ADS-Bit Screenshot](screenshots/screenshot.png)

## Features

- Real-time aircraft tracking via ADS-B receivers
- Custom pixel art sprites for 9 aircraft types (small prop, regional jet, narrow body, wide body, heavy, helicopter, balloon, glider, UAV)
- Animated sun and moon with accurate astronomical positions
- Dynamic sky colors based on time of day
- Weather visualization with cloud sprites
- Directional view (N/E/S/W) with themed backgrounds
- Auto-discovery of ADS-B receivers on your network, with per-interface scanning
- Canvas-based 10 FPS retro rendering
- Admin panel with password authentication
- **In-app pixel editor** — draw and edit sprites in the browser (pencil, shapes, fill, select & move, reference overlay, custom palettes)
- **Receiver health dashboard** — live per-receiver status (receiving / no data / unreachable), connection testing, and select → save → apply flow
- First-run setup wizard

## Quick Start

```bash
# Clone the repository
git clone https://gitea.chops.one/allen/ADS-Bit.git
cd ADS-Bit

# Install dependencies
pip install -r requirements.txt

# Start the server
python3 server.py
```

On first run, visit http://localhost:2001 and the setup wizard will guide you through configuration.

## Docker / Podman

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose V2, **or** [Podman](https://podman.io/) with `podman-compose`

### Run the prebuilt image (no clone needed)

Once a release is published, a multi-arch image (amd64 + arm64, e.g. Raspberry Pi)
is available from GitHub Container Registry:

```bash
docker run -d --name ads-bit --network host --restart unless-stopped \
  -e ADSBIT_CONFIG=/app/data/config.json \
  -v "$PWD/data:/app/data" \
  ghcr.io/OWNER/ads-bit:latest
```

Then open http://localhost:2001 and complete the setup wizard.

### Build from source

```bash
# Build and start — no config step needed
docker compose up -d
```

A config file is created automatically in `data/` on first run, then the
browser **setup wizard** walks you through receiver, location, and password
setup. The web UI is available at http://localhost:2001.

A `/health` endpoint (used by the container healthcheck) reports status,
version, and receiver/flight counts: `curl http://localhost:2001/health`.

### Useful Commands

```bash
# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after a git pull
docker compose build && docker compose up -d
```

### Podman

The same `docker-compose.yml` works with Podman:

```bash
podman-compose up -d
```

On SELinux systems (Fedora, RHEL), add `:Z` to each volume mount in `docker-compose.yml` so containers can access the bind-mounted files.

### Data Persistence

The following paths are bind-mounted from the repo directory and persist across container recreation:

| Path | Contents |
|------|----------|
| `data/` | Server configuration and credentials (`config.json`, auto-seeded) |
| `images/` | Aircraft and UI sprites (including uploads) |
| `backgrounds/` | Theme background images (including custom themes) |

Host networking (`network_mode: host`) is used so the server can auto-scan your LAN for ADS-B receivers. Auto-scan skips oversized subnets (larger than /20, e.g. a Docker bridge `172.17.0.0/16`); if your receiver lives on such a network, set it explicitly via the admin Receivers tab.

## Requirements

- Python 3.9–3.11 (3.12+ may require build tools for `netifaces`; the Docker image uses 3.11)
- ADS-B receiver providing SBS/BaseStation format on port 30003 (dump1090, readsb, etc.)
- Modern web browser with Canvas support

## Configuration

ADS-Bit uses a first-run setup wizard to configure your installation. You can also edit `config.json` directly:

```json
{
  "receivers": "AUTO",
  "receiver_port": 30003,
  "location": {
    "name": "My Location",
    "lat": 36.2788,
    "lon": -115.2283
  },
  "web_port": 2001,
  "theme": "desert"
}
```

**Important:** Set your `location.lat` and `location.lon` for accurate weather and sun/moon positioning.

See [CONFIG.md](CONFIG.md) for full configuration options including custom backgrounds and running as a service.

## Controls

- **Arrow Keys / A/D**: Rotate view direction
- View cycles through North, East, South, West
- Click aircraft in sidebar to highlight

## Aircraft Types

| Type | Detection |
|------|-----------|
| Helicopter | Low altitude + slow speed |
| Heavy (747/A380) | High altitude or specific callsigns |
| Wide Body | Very high altitude/speed |
| Narrow Body | Default commercial |
| Regional Jet | Regional carrier callsigns or lower altitude |
| Small Prop | N-prefix callsigns or very low/slow |

## Custom Backgrounds

Create backgrounds for your location:

1. Add 4 directional images to `backgrounds/custom/` (north.png, east.png, south.png, west.png)
2. Set `"theme": "custom"` in config.json
3. Restart the server

See [CONFIG.md](CONFIG.md) for image specifications and tips.

## Running as a Service

To auto-start on boot, see the systemd service instructions in [CONFIG.md](CONFIG.md#running-as-a-service-auto-start).

## Compatible Receivers

Works with any receiver providing SBS/BaseStation format on port 30003:
- dump1090 / dump1090-fa / dump1090-mutability
- readsb
- ADS-B Exchange feeders
- FlightAware PiAware
- Any SBS1 compatible receiver

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

- Aircraft and environment sprites generated with AI assistance
- Weather data from [Open-Meteo](https://open-meteo.com/) (free, no API key required)
