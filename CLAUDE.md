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
  - Parses SBS/BaseStation format messages from receivers
  - Broadcasts flight data to connected WebSocket clients every 1 second
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

- **setup/** - First-run setup wizard (multi-step configuration)

### Sprite Assets

All PNG sprites face right (eastward) and are flipped in-canvas for westbound aircraft:
- 6 aircraft types: smallProp, regionalJet, narrowBody, wideBody, heavy, helicopter
- Directional backgrounds: north.png, south.png, east.png, west.png (1536x1024, shown based on view direction)
- Celestial: sun.png, moon_6_phases.png (2x3 sprite sheet)
- Weather: happycloud.png (clear), raincloud.png (rain/snow)

### Aircraft Type Detection Logic

Priority order in categorization:
1. **Helicopter**: altitude < 5000 ft AND speed < 150 knots
2. **Heavy (747/A380)**: specific callsigns OR altitude > 42000 ft OR speed > 550 knots
3. **Wide Body**: altitude > 40000 ft OR speed > 500 knots
4. **Regional Jet**: specific callsigns OR (altitude < 25000 ft AND speed < 350 knots)
5. **Small Prop**: N-prefix callsigns OR (altitude < 10000 ft AND speed < 200 knots)
6. **Narrow Body**: default for remaining aircraft

### View Direction Controls

The viewer can rotate between cardinal directions (N/E/S/W), showing aircraft in a 90° field of view:
- **Keyboard**: Left/Right arrow keys or A/D keys
- **UI**: Arrow buttons on the interface
- Each direction displays a unique background image (north.png, east.png, south.png, west.png)
- Sun and moon positions are calculated based on actual azimuth and only appear when in the current field of view

### External APIs

- **Open-Meteo**: Weather and sunrise/sunset data (updates every 10 minutes)
- **ADS-B Receivers**: SBS/BaseStation protocol on port 30003

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
