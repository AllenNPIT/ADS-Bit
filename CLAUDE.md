# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ADS-Bit is a retro SNES-style side-view flight tracker that displays ADS-B aircraft data with custom pixel art sprites.

## Running the Server

```bash
# Start the server (port configured in config.json, default 2001)
python3 server.py

# Or use the startup script
./start.sh
```

Access at http://localhost:{web_port} (configured in config.json)

## Architecture

### Components

- **server.py** - Python WebSocket server using aiohttp
  - Reads configuration from config.json
  - Auto-scans for ADS-B receivers or connects to configured IPs
  - Parses SBS/BaseStation format messages from receivers (port 30003)
  - Polls dump1090 JSON API (`/dump1090/data/aircraft.json`) every 5s for ADS-B emitter categories
  - Broadcasts flight data (including emitter category) to WebSocket clients every 1 second
  - Cleans up flights not seen in 60 seconds
  - Serves static files, admin panel, setup wizard, and APIs
  - Authentication via bcrypt password hashing and session cookies

- **config.json** - Configuration file for receiver and location settings
  - See CONFIG.md for full documentation

- **ads-bit.js** - JavaScript rendering engine (Canvas-based)
  - Handles WebSocket connection and flight data updates
  - Renders 10 FPS retro-style canvas animation
  - Layer order (bottom to top): sky gradient → clouds → sun → moon → directional background → grid → aircraft → labels
  - Directional backgrounds include horizon, so low sun/moon is realistically occluded
  - Aircraft sprites flip horizontally when heading west (track 90°-270°)
  - View direction rotates between N/E/S/W (arrow keys or A/D), changing the background

- **index.html** - Main HTML interface with embedded styles

- **admin/** - Admin panel (login + tabbed settings UI)
  - Theme management: rename display names, upload per-direction background PNGs, create new themes
  - Display names stored in `config.json` `theme_names` map (folder name -> display name)
  - Receivers tab: live per-receiver health (via `GET /api/admin/receiver-status` and `POST /api/admin/test-receivers`), a select → SAVE & APPLY → auto-test flow, selectable scan results, and a per-interface scan selector
  - Version (from `server.py` `VERSION`) is surfaced via public `GET /api/config` and shown in the admin header
  - **pixel-editor.js** - In-app Canvas2D pixel editor (Sprites tab "EDIT" button)
    - Edits sprites at native 500x333; tools: pencil, eraser, color picker, fill bucket, pan, line, rectangle, ellipse (outline/filled), rectangular select
    - Select & move: marquee + floating layer, drag/arrow-nudge, Ctrl+C/X/V clipboard, Delete, Enter/Esc commit
    - Zoom/pan, undo/redo (snapshot-per-stroke), grid overlay, brush size & opacity, retro + custom (localStorage) + recent palettes, adjustable reference-image overlay
    - Exports a 500x333 PNG via `srcCanvas.toBlob` and POSTs to the existing `/api/admin/sprites/{type}` upload endpoint (no new server route)
    - Keyboard: B/E/I/F/L/R/O/M tools, Space=pan, +/-/0 zoom, Ctrl+Z/Y undo/redo, Ctrl+C/X/V, arrows nudge, G grid, Esc close
  - **Asset cache-busting:** `admin.html` references `admin.css`/`admin.js`/`pixel-editor.js` with a `?v=YYYYMMDD[x]` query — bump it whenever those files change so browsers reload them

- **setup/** - First-run setup wizard (multi-step configuration)

### Sprite Assets

All PNG sprites face right (eastward) and are flipped in-canvas for westbound aircraft:
- 9 aircraft types: smallProp, regionalJet, narrowBody, wideBody, heavy, helicopter, balloon, glider, uav
- Directional backgrounds: north.png, south.png, east.png, west.png (1536x1024, shown based on view direction)
- Celestial: sun.png, moon_6_phases.png (2x3 sprite sheet)
- Weather: happycloud.png (clear), raincloud.png (rain/snow)

### Aircraft Type Detection Logic

Two-tier system: real ADS-B emitter categories when available, heuristic fallback otherwise.

#### Tier 1: ADS-B Emitter Category (from dump1090 JSON API)

The server polls `http://{receiver_ip}/dump1090/data/aircraft.json` every 5 seconds. The SBS/BaseStation protocol (port 30003) does **not** include emitter category, but the dump1090/readsb JSON API exposes the raw ADS-B transponder category field. When available, this is authoritative and always preferred over heuristics.

Mapping from DO-260B emitter categories to sprite types:
| ADS-B Category | Description | Sprite |
|---|---|---|
| A1 | Light (< 15,500 lbs) | smallProp |
| A2 | Small (15,500 - 75,000 lbs) | regionalJet |
| A3 | Large (75,000 - 300,000 lbs) | narrowBody |
| A4 | High vortex large (B757) | narrowBody |
| A5 | Heavy (> 300,000 lbs) | wideBody or heavy (by altitude/speed) |
| A6 | High performance (> 5g, > 400 kts) | narrowBody |
| A7 | Rotorcraft | helicopter |
| B1 | Glider / sailplane | glider |
| B2 | Lighter-than-air | balloon |
| B4 | Skydiver drop plane | smallProp |
| B6 | UAV | uav |

Once an emitter category is received for an aircraft, it is locked in and heuristic re-evaluation is skipped.

#### Tier 2: Heuristic Fallback (when no emitter category available)

Priority order when ADS-B category is not available (some transponders don't broadcast it):
1. **Helicopter callsigns**: known operator prefixes (LFE, MED, CHP, PHI, ERA, BHS) or keywords (LIFE, MERCY, COPTER, etc.)
2. **Heavy/Wide body callsigns**: major airline ICAO prefixes (CPA, UAE, ETH, QTR, SIA, AAL, DAL, UAL, FDX, UPS, etc.) + altitude/speed thresholds
3. **Altitude/speed extremes**: altitude > 42000 ft or speed > 550 kts = heavy; > 40000 ft or > 500 kts = wideBody
4. **N-number (US GA registration)**: pattern `N` + digit + 2-4 alphanumerics = smallProp (or narrowBody if above 25000 ft)
5. **Regional airline callsigns**: SKW, RPA, ASH, PDT, CHQ, ENY, JIA, CPZ
6. **Speed/altitude heuristics**: speed < 60 + alt < 5000 = helicopter; alt < 18000 + speed < 300 = smallProp or regionalJet
7. **Altitude-only**: < 10000 ft = smallProp, < 25000 ft = regionalJet, higher = narrowBody
8. **Default**: narrowBody (re-evaluated when better data arrives)

Important: `speed=0` or `altitude=0` means data not yet received, not actual zero. The system re-categorizes when better data arrives (speed > 0 and callsign present).

### View Direction Controls

The viewer can rotate between cardinal directions (N/E/S/W), showing aircraft in a 90° field of view:
- **Keyboard**: Left/Right arrow keys or A/D keys
- **UI**: Arrow buttons on the interface
- Each direction displays a unique background image (north.png, east.png, south.png, west.png)
- Sun and moon positions are calculated based on actual azimuth and only appear when in the current field of view

### External APIs

- **Open-Meteo**: Weather and sunrise/sunset data (updates every 10 minutes)
- **ADS-B Receivers**: SBS/BaseStation protocol on port 30003 (flight data)
- **dump1090 JSON API**: `http://{receiver}/dump1090/data/aircraft.json` on port 80 (emitter categories, polled every 5s)

## Dependencies

Python packages required:
- aiohttp (web server and WebSocket)
- netifaces (network interface scanning)
- bcrypt (password hashing)

No package.json - frontend is vanilla JavaScript with no build step.

## Key Code Patterns

- Canvas version parameter on assets (`?v=36`) for cache busting
- Aircraft direction: `const isFacingLeft = flight.track > 90 && flight.track < 270`
- Moon phases use sprite sheet cropping with 2x3 grid (3 columns, 2 rows)
- Flight data stored in global `flights` dict keyed by ICAO hex code

## Debugging

```bash
# Check for running server instances
ps aux | grep server.py

# Kill all instances
pkill -9 -f server.py

# Test receiver connectivity (replace with your receiver IP)
nc -zv <receiver_ip> 30003
```
