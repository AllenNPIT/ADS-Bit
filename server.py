#!/usr/bin/env python3
"""ADS-Bit Server - Connects directly to ADS-B receivers"""
import asyncio
import socket
import json
import time
import os
import copy
import re
import secrets
import ipaddress
from pathlib import Path
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Dict, Set, List
from aiohttp import web, ClientSession, ClientTimeout
import netifaces
import bcrypt

VERSION = "1.1.1"

WEB_DIR = Path(__file__).parent
# Config path is overridable (handy for containers persisting config on a
# named volume); defaults to config.json next to this script for bare-metal.
CONFIG_FILE = Path(os.environ.get("ADSBIT_CONFIG") or (WEB_DIR / "config.json"))

# Smallest subnet prefix (largest network) we'll auto-scan: /20 = 4094 hosts.
# Anything bigger (e.g. a docker /16) is skipped to keep scans fast and safe.
MIN_SCAN_PREFIX = 20

# Track server start time
SERVER_START_TIME = time.time()

# Default configuration - all possible settings with sane defaults
DEFAULT_CONFIG = {
    "setup_complete": False,
    "admin": {
        "password_hash": "",
        "session_secret": ""
    },
    "receivers": "AUTO",
    "receiver_port": 30003,
    "location": {
        "name": "My Location",
        "lat": 0.0,
        "lon": 0.0
    },
    "web_port": 2001,
    "theme": "desert",
    "site": {
        "title": "ADS-Bit",
        "subtitle": "Retro Flight Tracker"
    },
    "display": {
        "temperature_unit": "F",
        "show_weather": True,
        "show_sidebar": True,
        "default_view_direction": 0
    },
    "tuning": {
        "flight_timeout_seconds": 60,
        "broadcast_interval_seconds": 1,
        "cleanup_interval_seconds": 10,
        "receiver_reconnect_seconds": 5
    },
    "theme_names": {}
}


def deep_merge(base: dict, override: dict) -> dict:
    """Deep merge override into base, returning new dict. Base values used as defaults."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


# Active configuration
config = copy.deepcopy(DEFAULT_CONFIG)


def load_config():
    """Load configuration from config.json, deep-merged over defaults."""
    global config
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r') as f:
                loaded = json.load(f)
                config = deep_merge(DEFAULT_CONFIG, loaded)
                print(f"Loaded config from {CONFIG_FILE}")
        except Exception as e:
            print(f"Error loading config: {e}, using defaults")
            config = copy.deepcopy(DEFAULT_CONFIG)
    else:
        print(f"No config file found at {CONFIG_FILE}, using defaults")
        config = copy.deepcopy(DEFAULT_CONFIG)

    print(f"  Setup complete: {config['setup_complete']}")
    print(f"  Receivers: {config['receivers']}")
    print(f"  Receiver port: {config['receiver_port']}")
    print(f"  Location: {config['location']['name']} ({config['location']['lat']}, {config['location']['lon']})")
    print(f"  Web port: {config['web_port']}")
    print(f"  Theme: {config.get('theme', 'desert')}")


def save_config():
    """Persist current config to config.json."""
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        print(f"Config saved to {CONFIG_FILE}")
    except Exception as e:
        print(f"Error saving config: {e}")


# ---------------------------------------------------------------------------
# Session management (in-memory, lost on restart)
# ---------------------------------------------------------------------------
sessions: Dict[str, float] = {}  # token -> expiry timestamp
SESSION_DURATION = 86400  # 24 hours


def create_session() -> str:
    token = secrets.token_hex(32)
    sessions[token] = time.time() + SESSION_DURATION
    return token


def validate_session(token: str) -> bool:
    if not token:
        return False
    expiry = sessions.get(token)
    if expiry is None:
        return False
    if time.time() > expiry:
        sessions.pop(token, None)
        return False
    return True


def destroy_session(token: str):
    sessions.pop(token, None)


def get_session_token(request) -> str:
    """Extract session token from cookie."""
    return request.cookies.get('adsbit_session', '')


def require_auth(handler):
    """Decorator that checks for valid admin session."""
    async def wrapper(request):
        token = get_session_token(request)
        if not validate_session(token):
            return web.json_response({"error": "Unauthorized"}, status=401)
        return await handler(request)
    return wrapper


def require_setup_incomplete(handler):
    """Decorator that only allows access when setup is not complete."""
    async def wrapper(request):
        if config.get("setup_complete", False):
            return web.json_response({"error": "Setup already complete"}, status=403)
        return await handler(request)
    return wrapper


# ---------------------------------------------------------------------------
# Flight data storage
# ---------------------------------------------------------------------------
flights: Dict[str, dict] = {}
connected_clients: Set = set()
receivers: List[str] = []
receiver_tasks: List[asyncio.Task] = []
emitter_categories: Dict[str, str] = {}  # ICAO hex -> ADS-B emitter category (A1, A3, A7, etc.)

# Live per-receiver connection health, keyed by IP. Each entry:
#   {"state": "connecting"|"connected"|"down", "last_msg": ts|None,
#    "msg_count": int, "connected_since": ts|None, "error": str}
receiver_status: Dict[str, dict] = {}

# A receiver is considered "receiving" if it produced a message this recently.
RECEIVER_DATA_FRESH_SECONDS = 30


def reset_receiver_status(ips):
    """Replace the tracked receiver set, marking each as connecting."""
    global receiver_status
    receiver_status = {
        ip: {"state": "connecting", "last_msg": None,
             "msg_count": 0, "connected_since": None, "error": ""}
        for ip in ips
    }


def describe_receiver(ip, reachable=None):
    """Build a display-friendly status object for one receiver.

    state -> (label, color):
      down/missing       -> DOWN (red)
      connecting         -> CONNECTING (gray)
      connected + data   -> RECEIVING (green)
      connected, no data -> NO DATA (yellow)  (socket up; maybe no aircraft in range)
    reachable: optional active port-probe result that overrides a stale state.
    """
    st = receiver_status.get(ip)
    now = time.time()
    if st is None:
        state, last_age, msg_count = "down", None, 0
    else:
        state = st["state"]
        last_age = (now - st["last_msg"]) if st["last_msg"] else None
        msg_count = st["msg_count"]

    # An active probe result is authoritative about reachability.
    if reachable is False:
        state = "down"
    elif reachable is True and state == "down":
        state = "connected"

    if state == "down":
        label, color = "DOWN", "red"
    elif state == "connecting":
        label, color = "CONNECTING", "gray"
    elif last_age is not None and last_age <= RECEIVER_DATA_FRESH_SECONDS:
        label, color = "RECEIVING", "green"
    else:
        label, color = "NO DATA", "yellow"

    return {
        "ip": ip,
        "state": state,
        "label": label,
        "color": color,
        "msg_count": msg_count,
        "last_msg_age": round(last_age, 1) if last_age is not None else None,
        "reachable": reachable,
    }


@dataclass
class SBSMessage:
    msg_type: str
    icao: str
    callsign: str = ""
    altitude: int = 0
    speed: float = 0
    track: float = 0
    lat: float = 0
    lon: float = 0
    vrate: int = 0
    squawk: str = ""
    ground: bool = False


def parse_sbs_message(line: str):
    """Parse SBS/BaseStation format message"""
    parts = line.strip().split(',')
    if len(parts) < 10:
        return None

    msg_type = parts[0]
    if msg_type not in ['MSG']:
        return None

    icao = parts[4].strip()
    if not icao:
        return None

    msg = SBSMessage(msg_type=msg_type, icao=icao)

    if len(parts) > 10 and parts[10].strip():
        msg.callsign = parts[10].strip()
    if len(parts) > 11 and parts[11].strip():
        try:
            msg.altitude = int(parts[11])
        except ValueError:
            pass
    if len(parts) > 12 and parts[12].strip():
        try:
            msg.speed = float(parts[12])
        except ValueError:
            pass
    if len(parts) > 13 and parts[13].strip():
        try:
            msg.track = float(parts[13])
        except ValueError:
            pass
    if len(parts) > 14 and parts[14].strip():
        try:
            msg.lat = float(parts[14])
        except ValueError:
            pass
    if len(parts) > 15 and parts[15].strip():
        try:
            msg.lon = float(parts[15])
        except ValueError:
            pass
    if len(parts) > 16 and parts[16].strip():
        try:
            msg.vrate = int(parts[16])
        except ValueError:
            pass
    if len(parts) > 17 and parts[17].strip():
        msg.squawk = parts[17].strip()
    if len(parts) > 21 and parts[21].strip() == '-1':
        msg.ground = True

    return msg


async def connect_to_receiver(host: str, port: int = 30003):
    """Connect to an SBS receiver and process messages"""
    reconnect_delay = config['tuning']['receiver_reconnect_seconds']
    print(f"Connecting to receiver at {host}:{port}...")
    # Ensure a status entry exists even if this task started outside a reset.
    receiver_status.setdefault(host, {"state": "connecting", "last_msg": None,
                                       "msg_count": 0, "connected_since": None, "error": ""})
    while True:
        try:
            receiver_status[host]["state"] = "connecting"
            reader, writer = await asyncio.open_connection(host, port)
            print(f"Connected to {host}:{port}")
            receiver_status[host]["state"] = "connected"
            receiver_status[host]["connected_since"] = time.time()
            receiver_status[host]["error"] = ""

            while True:
                line = await reader.readline()
                if not line:
                    break

                line = line.decode('utf-8', errors='ignore')
                msg = parse_sbs_message(line)
                if msg and msg.icao:
                    receiver_status[host]["last_msg"] = time.time()
                    receiver_status[host]["msg_count"] += 1
                    if msg.icao not in flights:
                        flights[msg.icao] = {
                            'icao': msg.icao,
                            'callsign': '',
                            'altitude': 0,
                            'speed': 0,
                            'track': 0,
                            'lat': 0,
                            'lon': 0,
                            'vrate': 0,
                            'squawk': '',
                            'ground': False,
                            'category': emitter_categories.get(msg.icao.upper(), ''),
                            'last_seen': time.time()
                        }

                    flight = flights[msg.icao]
                    if msg.callsign:
                        flight['callsign'] = msg.callsign
                    if msg.altitude:
                        flight['altitude'] = msg.altitude
                    if msg.speed:
                        flight['speed'] = msg.speed
                    if msg.track:
                        flight['track'] = msg.track
                    if msg.lat:
                        flight['lat'] = msg.lat
                    if msg.lon:
                        flight['lon'] = msg.lon
                    if msg.vrate:
                        flight['vrate'] = msg.vrate
                    if msg.squawk:
                        flight['squawk'] = msg.squawk
                    flight['ground'] = msg.ground
                    flight['last_seen'] = time.time()

            # readline returned empty -> peer closed the connection.
            receiver_status[host]["state"] = "down"
            writer.close()
            await writer.wait_closed()
        except Exception as e:
            print(f"Receiver {host}:{port} error: {e}")
            receiver_status[host]["state"] = "down"
            receiver_status[host]["error"] = str(e)
            await asyncio.sleep(reconnect_delay)


async def _scan_subnet(network, port):
    """Scan a single subnet for hosts with an open port. Returns list of IPs."""
    found = []
    print(f"Scanning {network} ({network.num_addresses} hosts) on port {port}...")
    host_ips = [str(host) for host in network.hosts()]

    async def check_ip(test_ip):
        if await test_port(test_ip, port):
            return test_ip
        return None

    results = await asyncio.gather(*[check_ip(h) for h in host_ips])
    for result in results:
        if result:
            print(f"Found receiver at {result}:{port}")
            found.append(result)
    return found


async def scan_for_receivers():
    """Scan local network for ADS-B receivers on configured port"""
    port = config['receiver_port']
    print(f"Scanning for ADS-B receivers on port {port}...")
    found = []

    for iface in netifaces.interfaces():
        addrs = netifaces.ifaddresses(iface)
        if netifaces.AF_INET in addrs:
            for addr in addrs[netifaces.AF_INET]:
                ip = addr.get('addr')
                netmask = addr.get('netmask')
                if ip and netmask and not ip.startswith('127.'):
                    try:
                        network = ipaddress.IPv4Network(f"{ip}/{netmask}", strict=False)
                        # Skip subnets too large to scan quickly (e.g. a docker
                        # bridge /16 = 65k hosts). Without this, AUTO discovery
                        # hammers the network and stalls startup on any host with
                        # Docker or a large/16. Use MANUAL or a custom subnet for
                        # receivers that live on such networks.
                        if network.prefixlen < MIN_SCAN_PREFIX:
                            print(f"Skipping {network} on {iface}: too large "
                                  f"({network.num_addresses} hosts) for auto-scan")
                            continue
                        found.extend(await _scan_subnet(network, port))
                    except ValueError as e:
                        print(f"Invalid network {ip}/{netmask}: {e}")

    return found


async def test_port(ip: str, port: int, timeout: float = 0.5):
    """Test if a port is open"""
    try:
        conn = asyncio.open_connection(ip, port)
        reader, writer = await asyncio.wait_for(conn, timeout=timeout)
        writer.close()
        await writer.wait_closed()
        return True
    except:
        return False


async def poll_aircraft_json():
    """Poll dump1090/readsb JSON API to get ADS-B emitter categories.

    The SBS/BaseStation protocol (port 30003) doesn't include emitter category,
    but the dump1090 JSON API exposes the raw ADS-B category field (A1=Light,
    A2=Small, A3=Large, A5=Heavy, A7=Rotorcraft, etc.). This task periodically
    fetches that data and merges it into the flights dict.
    """
    # Wait for receivers to be determined before starting
    await asyncio.sleep(5)

    json_api_urls = []
    for receiver_ip in receivers:
        json_api_urls.append(f"http://{receiver_ip}/dump1090/data/aircraft.json")

    if not json_api_urls:
        print("No receivers for JSON API polling")
        return

    timeout = ClientTimeout(total=5)
    print(f"Starting JSON API polling for emitter categories: {json_api_urls}")

    async with ClientSession(timeout=timeout) as session:
        while True:
            for url in json_api_urls:
                try:
                    async with session.get(url) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            aircraft_list = data.get("aircraft", [])
                            count = 0
                            for ac in aircraft_list:
                                hex_code = ac.get("hex", "").strip().upper()
                                cat = ac.get("category", "")
                                if hex_code and cat:
                                    emitter_categories[hex_code] = cat
                                    # Merge into active flight if present
                                    if hex_code in flights:
                                        flights[hex_code]["category"] = cat
                                    count += 1
                except Exception:
                    pass  # JSON API not available on this receiver, use heuristics

            await asyncio.sleep(5)


async def cleanup_old_flights():
    """Remove flights not seen recently (uses tuning config)."""
    while True:
        interval = config['tuning']['cleanup_interval_seconds']
        timeout = config['tuning']['flight_timeout_seconds']
        await asyncio.sleep(interval)
        now = time.time()
        to_remove = [icao for icao, flight in flights.items()
                     if now - flight['last_seen'] > timeout]
        for icao in to_remove:
            del flights[icao]


async def broadcast_flights():
    """Broadcast flight data to all connected WebSocket clients."""
    while True:
        interval = config['tuning']['broadcast_interval_seconds']
        await asyncio.sleep(interval)
        if connected_clients:
            flight_list = [f for f in flights.values() if f['lat'] and f['lon']]
            message = json.dumps({
                'type': 'flights',
                'flights': flight_list,
                'count': len(flight_list)
            })

            dead_clients = set()
            for client in connected_clients:
                try:
                    await client.send_str(message)
                except:
                    dead_clients.add(client)

            connected_clients.difference_update(dead_clients)


# ---------------------------------------------------------------------------
# WebSocket handler
# ---------------------------------------------------------------------------
async def websocket_handler(request):
    """Handle WebSocket connections from browser"""
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    connected_clients.add(ws)
    print(f"WebSocket client connected ({len(connected_clients)} total)")

    try:
        async for msg in ws:
            pass
    finally:
        connected_clients.discard(ws)
        print(f"WebSocket client disconnected ({len(connected_clients)} remaining)")

    return ws


# ---------------------------------------------------------------------------
# Public API routes (no auth)
# ---------------------------------------------------------------------------
async def handle_receiver_location(request):
    """Return receiver location from config."""
    return web.json_response({
        "lat": config["location"]["lat"],
        "lon": config["location"]["lon"],
        "name": config["location"]["name"]
    })


async def handle_config(request):
    """Return client-relevant configuration (public, no secrets)."""
    return web.json_response({
        "version": VERSION,
        "theme": config.get("theme", "desert"),
        "location": config["location"],
        "receivers": receivers,
        "site": config.get("site", DEFAULT_CONFIG["site"]),
        "display": config.get("display", DEFAULT_CONFIG["display"])
    })


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
async def handle_auth_login(request):
    """POST /api/auth/login - Authenticate with admin password."""
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    password = body.get("password", "")
    stored_hash = config.get("admin", {}).get("password_hash", "")

    if not stored_hash:
        return web.json_response({"error": "No admin password set"}, status=403)

    try:
        if bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8')):
            token = create_session()
            resp = web.json_response({"ok": True})
            resp.set_cookie('adsbit_session', token,
                            max_age=SESSION_DURATION,
                            httponly=True,
                            samesite='Lax',
                            path='/')
            return resp
    except Exception:
        pass

    return web.json_response({"error": "Invalid password"}, status=401)


async def handle_auth_logout(request):
    """POST /api/auth/logout - Destroy session."""
    token = get_session_token(request)
    destroy_session(token)
    resp = web.json_response({"ok": True})
    resp.del_cookie('adsbit_session', path='/')
    return resp


async def handle_auth_check(request):
    """GET /api/auth/check - Check if current session is valid."""
    token = get_session_token(request)
    if validate_session(token):
        return web.json_response({"authenticated": True})
    return web.json_response({"authenticated": False}, status=401)


# ---------------------------------------------------------------------------
# Setup routes (only when setup_complete is false)
# ---------------------------------------------------------------------------
@require_setup_incomplete
async def handle_setup_password(request):
    """POST /api/setup/password - Set initial admin password."""
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    password = body.get("password", "")
    if len(password) < 4:
        return web.json_response({"error": "Password must be at least 4 characters"}, status=400)

    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    config['admin']['password_hash'] = hashed
    config['admin']['session_secret'] = secrets.token_hex(16)
    save_config()
    return web.json_response({"ok": True})


@require_setup_incomplete
async def handle_setup_location(request):
    """POST /api/setup/location - Set location during setup."""
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    config['location']['name'] = body.get("name", config['location']['name'])
    config['location']['lat'] = float(body.get("lat", config['location']['lat']))
    config['location']['lon'] = float(body.get("lon", config['location']['lon']))
    save_config()
    return web.json_response({"ok": True, "location": config['location']})


@require_setup_incomplete
async def handle_setup_receivers(request):
    """POST /api/setup/receivers - Configure receivers during setup."""
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    mode = body.get("mode", "AUTO")
    if mode == "AUTO":
        config['receivers'] = "AUTO"
    else:
        ips = body.get("ips", [])
        if isinstance(ips, list) and ips:
            config['receivers'] = ips
        else:
            config['receivers'] = "AUTO"

    if "port" in body:
        config['receiver_port'] = int(body['port'])

    save_config()
    return web.json_response({"ok": True})


@require_setup_incomplete
async def handle_setup_scan(request):
    """GET /api/setup/scan - Scan for receivers during setup."""
    found = await scan_for_receivers()
    return web.json_response({"receivers": found})


@require_setup_incomplete
async def handle_setup_theme(request):
    """POST /api/setup/theme - Set theme and preferences during setup."""
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    if "theme" in body:
        config['theme'] = body['theme']
    if "temperature_unit" in body:
        config['display']['temperature_unit'] = body['temperature_unit']
    if "site_title" in body:
        config['site']['title'] = body['site_title']
    if "site_subtitle" in body:
        config['site']['subtitle'] = body['site_subtitle']

    save_config()
    return web.json_response({"ok": True})


@require_setup_incomplete
async def handle_setup_complete(request):
    """POST /api/setup/complete - Mark setup as done."""
    # Verify a password was set
    if not config.get('admin', {}).get('password_hash', ''):
        return web.json_response({"error": "Admin password must be set first"}, status=400)

    config['setup_complete'] = True
    save_config()

    # Restart receiver connections with new config
    await restart_receiver_connections()

    return web.json_response({"ok": True})


# ---------------------------------------------------------------------------
# Admin API routes (require auth)
# ---------------------------------------------------------------------------
@require_auth
async def handle_admin_config(request):
    """GET /api/admin/config - Return full config (minus password hash)."""
    safe_config = copy.deepcopy(config)
    safe_config['admin'] = {"password_set": bool(config['admin']['password_hash'])}
    return web.json_response(safe_config)


@require_auth
async def handle_admin_config_update(request):
    """PUT /api/admin/config - Update config sections."""
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    # Updatable sections
    if "location" in body:
        loc = body["location"]
        if "name" in loc:
            config['location']['name'] = loc['name']
        if "lat" in loc:
            config['location']['lat'] = float(loc['lat'])
        if "lon" in loc:
            config['location']['lon'] = float(loc['lon'])

    if "receivers" in body:
        config['receivers'] = body['receivers']

    if "receiver_port" in body:
        config['receiver_port'] = int(body['receiver_port'])

    if "theme" in body:
        config['theme'] = body['theme']

    if "site" in body:
        for k in ('title', 'subtitle'):
            if k in body['site']:
                config['site'][k] = body['site'][k]

    if "display" in body:
        for k in ('temperature_unit', 'show_weather', 'show_sidebar', 'default_view_direction'):
            if k in body['display']:
                config['display'][k] = body['display'][k]

    if "tuning" in body:
        for k in ('flight_timeout_seconds', 'broadcast_interval_seconds',
                   'cleanup_interval_seconds', 'receiver_reconnect_seconds'):
            if k in body['tuning']:
                config['tuning'][k] = int(body['tuning'][k])

    save_config()
    return web.json_response({"ok": True})


@require_auth
async def handle_admin_status(request):
    """GET /api/admin/status - Live dashboard data."""
    flight_list = [f for f in flights.values() if f['lat'] and f['lon']]
    uptime = int(time.time() - SERVER_START_TIME)
    hours, remainder = divmod(uptime, 3600)
    minutes, seconds = divmod(remainder, 60)

    return web.json_response({
        "active_flights": len(flight_list),
        "total_tracked": len(flights),
        "connected_viewers": len(connected_clients),
        "receivers": receivers,
        "receiver_count": len(receivers),
        "uptime": f"{hours}h {minutes}m {seconds}s",
        "uptime_seconds": uptime
    })


VALID_DIRECTIONS = ("north", "east", "south", "west")


@require_auth
async def handle_admin_themes(request):
    """GET /api/admin/themes - List available themes with display names and directions."""
    bg_dir = WEB_DIR / "backgrounds"
    themes = []
    theme_names = config.get("theme_names", {})
    if bg_dir.exists():
        for d in sorted(bg_dir.iterdir()):
            if d.is_dir():
                directions = {}
                for direction in VALID_DIRECTIONS:
                    directions[direction] = (d / f"{direction}.png").exists()
                display_name = theme_names.get(d.name, d.name.replace("_", " ").replace("-", " ").title())
                themes.append({
                    "id": d.name,
                    "name": display_name,
                    "directions": directions,
                })
    return web.json_response({"themes": themes, "active": config.get("theme", "desert")})


def _valid_theme_id(theme_id: str) -> bool:
    """Reject path-traversal attempts in theme IDs."""
    return bool(theme_id) and '/' not in theme_id and '\\' not in theme_id and theme_id not in ('.', '..')


@require_auth
async def handle_admin_theme_create(request):
    """POST /api/admin/themes - Create a new theme."""
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    name = body.get("name", "").strip()
    if not name:
        return web.json_response({"error": "Theme name is required"}, status=400)

    # Generate slug from name
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    if not slug or not _valid_theme_id(slug):
        return web.json_response({"error": "Invalid theme name"}, status=400)

    bg_dir = WEB_DIR / "backgrounds" / slug
    if bg_dir.exists():
        return web.json_response({"error": "Theme already exists"}, status=409)

    bg_dir.mkdir(parents=True, exist_ok=True)
    config.setdefault("theme_names", {})[slug] = name
    save_config()
    return web.json_response({"ok": True, "id": slug, "name": name})


@require_auth
async def handle_admin_theme_rename(request):
    """PUT /api/admin/themes/{id} - Rename a theme's display name."""
    theme_id = request.match_info.get("id", "")
    if not _valid_theme_id(theme_id):
        return web.json_response({"error": "Invalid theme ID"}, status=400)
    bg_dir = WEB_DIR / "backgrounds" / theme_id
    if not bg_dir.exists() or not bg_dir.is_dir():
        return web.json_response({"error": "Theme not found"}, status=404)

    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    name = body.get("name", "").strip()
    if not name:
        return web.json_response({"error": "Display name is required"}, status=400)

    config.setdefault("theme_names", {})[theme_id] = name
    save_config()
    return web.json_response({"ok": True, "id": theme_id, "name": name})


@require_auth
async def handle_admin_theme_upload(request):
    """POST /api/admin/themes/{id}/{direction} - Upload a background PNG."""
    theme_id = request.match_info.get("id", "")
    direction = request.match_info.get("direction", "")

    if not _valid_theme_id(theme_id):
        return web.json_response({"error": "Invalid theme ID"}, status=400)
    if direction not in VALID_DIRECTIONS:
        return web.json_response({"error": f"Invalid direction: {direction}"}, status=400)

    bg_dir = WEB_DIR / "backgrounds" / theme_id
    if not bg_dir.exists() or not bg_dir.is_dir():
        return web.json_response({"error": "Theme not found"}, status=404)

    reader = await request.multipart()
    field = await reader.next()
    if field is None or field.name != "file":
        return web.json_response({"error": "No file field in upload"}, status=400)

    # Read the uploaded file (limit to 10 MB for background images)
    data = bytearray()
    while True:
        chunk = await field.read_chunk(8192)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > 10 * 1024 * 1024:
            return web.json_response({"error": "File too large (max 10 MB)"}, status=400)

    # Validate PNG header
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return web.json_response({"error": "File is not a valid PNG"}, status=400)

    filepath = bg_dir / f"{direction}.png"
    with open(filepath, "wb") as f:
        f.write(data)

    return web.json_response({"ok": True, "id": theme_id, "direction": direction})


@require_auth
async def handle_admin_password(request):
    """POST /api/admin/password - Change admin password."""
    try:
        body = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    current = body.get("current_password", "")
    new_pw = body.get("new_password", "")

    if len(new_pw) < 4:
        return web.json_response({"error": "Password must be at least 4 characters"}, status=400)

    stored_hash = config.get("admin", {}).get("password_hash", "")
    if stored_hash:
        try:
            if not bcrypt.checkpw(current.encode('utf-8'), stored_hash.encode('utf-8')):
                return web.json_response({"error": "Current password is incorrect"}, status=401)
        except Exception:
            return web.json_response({"error": "Current password is incorrect"}, status=401)

    hashed = bcrypt.hashpw(new_pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    config['admin']['password_hash'] = hashed
    save_config()
    return web.json_response({"ok": True})


@require_auth
async def handle_admin_network_info(request):
    """GET /api/admin/network-info - Return the server's network interfaces."""
    interfaces = []
    for iface in netifaces.interfaces():
        addrs = netifaces.ifaddresses(iface)
        if netifaces.AF_INET in addrs:
            for addr in addrs[netifaces.AF_INET]:
                ip = addr.get('addr')
                netmask = addr.get('netmask')
                if ip and netmask and not ip.startswith('127.'):
                    try:
                        network = ipaddress.IPv4Network(f"{ip}/{netmask}", strict=False)
                        interfaces.append({
                            "name": iface,
                            "ip": ip,
                            "netmask": netmask,
                            "network": str(network)
                        })
                    except ValueError:
                        pass
    return web.json_response({"interfaces": interfaces})


@require_auth
async def handle_admin_scan_receivers(request):
    """POST /api/admin/scan-receivers - Trigger a receiver scan."""
    # Check for optional subnet in request body
    subnet = None
    try:
        body = await request.json()
        subnet = body.get("subnet")
    except:
        pass  # No body or invalid JSON — fall back to full scan

    if subnet:
        # Validate and scan a specific subnet
        try:
            network = ipaddress.IPv4Network(subnet, strict=False)
        except (ValueError, TypeError):
            return web.json_response(
                {"error": f"Invalid subnet: {subnet}"}, status=400)

        if network.prefixlen < MIN_SCAN_PREFIX:
            return web.json_response(
                {"error": f"Subnet too large (max /{MIN_SCAN_PREFIX} = "
                          f"{2 ** (32 - MIN_SCAN_PREFIX) - 2} hosts)"}, status=400)

        port = config['receiver_port']
        found = await _scan_subnet(network, port)
    else:
        found = await scan_for_receivers()

    return web.json_response({"receivers": found})


# All valid sprite type names
SPRITE_TYPES = [
    "smallProp", "regionalJet", "narrowBody", "wideBody",
    "heavy", "helicopter", "balloon", "glider", "uav"
]

# Which ADS-B emitter categories map to each sprite
SPRITE_CATEGORY_MAP = {
    "smallProp": "A1, B4",
    "regionalJet": "A2",
    "narrowBody": "A3, A4, A6",
    "wideBody": "A5 (lower alt/speed)",
    "heavy": "A5 (high alt/speed)",
    "helicopter": "A7",
    "balloon": "B2",
    "glider": "B1",
    "uav": "B6",
}


@require_auth
async def handle_admin_sprites(request):
    """GET /api/admin/sprites - List all sprite types with exists/url info."""
    sprites = []
    for stype in SPRITE_TYPES:
        filepath = WEB_DIR / "images" / f"{stype}.png"
        sprites.append({
            "type": stype,
            "exists": filepath.exists(),
            "url": f"/images/{stype}.png",
            "categories": SPRITE_CATEGORY_MAP.get(stype, ""),
        })
    return web.json_response({"sprites": sprites})


@require_auth
async def handle_admin_sprite_upload(request):
    """POST /api/admin/sprites/{type} - Upload/replace a sprite PNG."""
    stype = request.match_info.get("type", "")
    if stype not in SPRITE_TYPES:
        return web.json_response(
            {"error": f"Invalid sprite type: {stype}"}, status=400
        )

    reader = await request.multipart()
    field = await reader.next()
    if field is None or field.name != "file":
        return web.json_response({"error": "No file field in upload"}, status=400)

    # Read the uploaded file (limit to 5 MB)
    data = bytearray()
    while True:
        chunk = await field.read_chunk(8192)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > 5 * 1024 * 1024:
            return web.json_response({"error": "File too large (max 5 MB)"}, status=400)

    # Validate PNG header
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return web.json_response({"error": "File is not a valid PNG"}, status=400)

    # Save to images directory
    filepath = WEB_DIR / "images" / f"{stype}.png"
    with open(filepath, "wb") as f:
        f.write(data)

    return web.json_response({"ok": True, "type": stype})


async def restart_receiver_connections():
    """Cancel existing receiver tasks and start new ones."""
    global receivers, receiver_tasks

    # Cancel old tasks and let them unwind cleanly. Awaiting the cancelled
    # tasks here (with return_exceptions) absorbs their CancelledError so it
    # can never propagate into the main event loop.
    old_tasks = list(receiver_tasks)
    receiver_tasks.clear()
    for task in old_tasks:
        task.cancel()
    if old_tasks:
        await asyncio.gather(*old_tasks, return_exceptions=True)

    # Determine receivers
    receiver_config = config["receivers"]
    receiver_port = config["receiver_port"]

    try:
        if receiver_config == "AUTO":
            found = await scan_for_receivers()
            receivers = found
        elif isinstance(receiver_config, list):
            receivers = list(receiver_config)
        elif isinstance(receiver_config, str) and receiver_config != "AUTO":
            receivers = [receiver_config]
        else:
            receivers = []
    except Exception as e:
        print(f"Error determining receivers: {e}")
        receivers = []

    # Reset health tracking to the new receiver set.
    reset_receiver_status(receivers)

    # Start new tasks
    for r in receivers:
        task = asyncio.create_task(connect_to_receiver(r, receiver_port))
        receiver_tasks.append(task)

    print(f"Receiver connections restarted: {len(receivers)} receiver(s)")


@require_auth
async def handle_admin_restart_receivers(request):
    """POST /api/admin/restart-receivers - Restart all receiver connections."""
    await restart_receiver_connections()
    return web.json_response({"ok": True, "receivers": receivers})


@require_auth
async def handle_admin_receiver_status(request):
    """GET /api/admin/receiver-status - Live health of configured receivers."""
    statuses = [describe_receiver(ip) for ip in receivers]
    return web.json_response({
        "receivers": statuses,
        "configured": config["receivers"],   # "AUTO" or a list of IPs
        "count": len(receivers),
    })


@require_auth
async def handle_admin_test_receivers(request):
    """POST /api/admin/test-receivers - Actively probe each configured receiver
    and report reachability combined with live data-flow state."""
    port = config["receiver_port"]
    probes = await asyncio.gather(*[test_port(ip, port) for ip in receivers])
    statuses = [describe_receiver(ip, reachable=reachable)
                for ip, reachable in zip(receivers, probes)]
    return web.json_response({"receivers": statuses, "count": len(receivers)})


# ---------------------------------------------------------------------------
# Static file serving with setup redirect
# ---------------------------------------------------------------------------
async def handle_http(request):
    """Serve static files, with setup redirect logic."""
    path = request.path

    # Root redirect: if setup not complete, redirect to /setup
    if path == '/' or path == '/index.html':
        if not config.get('setup_complete', False):
            raise web.HTTPFound('/setup')
        path = '/index.html'

    # Serve /setup -> setup/setup.html
    if path == '/setup' or path == '/setup/':
        file_path = WEB_DIR / 'setup' / 'setup.html'
        if file_path.exists():
            return web.FileResponse(file_path)
        return web.Response(status=404, text="Setup page not found")

    # Serve /admin -> admin/admin.html
    if path == '/admin' or path == '/admin/':
        file_path = WEB_DIR / 'admin' / 'admin.html'
        if file_path.exists():
            return web.FileResponse(file_path)
        return web.Response(status=404, text="Admin page not found")

    file_path = WEB_DIR / path.lstrip('/')
    if file_path.exists() and file_path.is_file():
        return web.FileResponse(file_path)
    return web.Response(status=404, text="Not Found")


async def handle_health(request):
    """GET /health - liveness/readiness probe (no auth, no secrets)."""
    return web.json_response({
        "status": "ok",
        "version": VERSION,
        "receivers": len(receivers),
        "flights": len(flights),
        "uptime_seconds": int(time.time() - SERVER_START_TIME),
    })


# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------
async def start_http_server():
    """Start HTTP server with WebSocket support."""
    port = config["web_port"]
    app = web.Application()

    # WebSocket
    app.router.add_get('/ws', websocket_handler)

    # Public API
    app.router.add_get('/health', handle_health)
    app.router.add_get('/api/receiver-location', handle_receiver_location)
    app.router.add_get('/api/config', handle_config)

    # Auth API
    app.router.add_post('/api/auth/login', handle_auth_login)
    app.router.add_post('/api/auth/logout', handle_auth_logout)
    app.router.add_get('/api/auth/check', handle_auth_check)

    # Setup API
    app.router.add_post('/api/setup/password', handle_setup_password)
    app.router.add_post('/api/setup/location', handle_setup_location)
    app.router.add_post('/api/setup/receivers', handle_setup_receivers)
    app.router.add_get('/api/setup/scan', handle_setup_scan)
    app.router.add_post('/api/setup/theme', handle_setup_theme)
    app.router.add_post('/api/setup/complete', handle_setup_complete)

    # Admin API
    app.router.add_get('/api/admin/config', handle_admin_config)
    app.router.add_put('/api/admin/config', handle_admin_config_update)
    app.router.add_get('/api/admin/status', handle_admin_status)
    app.router.add_get('/api/admin/themes', handle_admin_themes)
    app.router.add_post('/api/admin/themes', handle_admin_theme_create)
    app.router.add_put('/api/admin/themes/{id}', handle_admin_theme_rename)
    app.router.add_post('/api/admin/themes/{id}/{direction}', handle_admin_theme_upload)
    app.router.add_post('/api/admin/password', handle_admin_password)
    app.router.add_get('/api/admin/network-info', handle_admin_network_info)
    app.router.add_post('/api/admin/scan-receivers', handle_admin_scan_receivers)
    app.router.add_post('/api/admin/restart-receivers', handle_admin_restart_receivers)
    app.router.add_get('/api/admin/receiver-status', handle_admin_receiver_status)
    app.router.add_post('/api/admin/test-receivers', handle_admin_test_receivers)
    app.router.add_get('/api/admin/sprites', handle_admin_sprites)
    app.router.add_post('/api/admin/sprites/{type}', handle_admin_sprite_upload)

    # Static files (must be last - catch-all)
    app.router.add_get('/{tail:.*}', handle_http)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    print(f"HTTP server running on http://0.0.0.0:{port}")
    if not config.get('setup_complete', False):
        print(f"First-run setup at http://0.0.0.0:{port}/setup")
    print(f"Admin panel at http://0.0.0.0:{port}/admin")


async def main():
    """Main entry point"""
    global receivers, receiver_tasks

    print(f"ADS-Bit Server v{VERSION} Starting...")

    load_config()

    print(f"Access at http://0.0.0.0:{config['web_port']}")

    # Get receivers based on config
    receiver_config = config["receivers"]
    receiver_port = config["receiver_port"]

    if receiver_config == "AUTO":
        found = await scan_for_receivers()
        receivers = found
    elif isinstance(receiver_config, list):
        receivers = receiver_config
        print(f"Using configured receivers: {receivers}")
    elif isinstance(receiver_config, str):
        receivers = [receiver_config]
        print(f"Using configured receiver: {receivers[0]}")

    if not receivers:
        print("WARNING: No receivers found or configured!")
    else:
        print(f"Using {len(receivers)} receiver(s)")

    reset_receiver_status(receivers)

    # Start all tasks
    tasks = [
        start_http_server(),
        cleanup_old_flights(),
        broadcast_flights(),
        poll_aircraft_json(),
    ]

    # Connect to all receivers. These run as independent background tasks and
    # are deliberately NOT awaited in the gather below: restarting receivers
    # cancels them, and a cancelled task inside the main gather would tear down
    # the whole server. They still run as long as the event loop is alive.
    for receiver in receivers:
        task = asyncio.ensure_future(connect_to_receiver(receiver, receiver_port))
        receiver_tasks.append(task)

    # Only the core services keep the server alive.
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    # Make SIGTERM (docker stop, systemctl stop) raise KeyboardInterrupt like
    # SIGINT does, so shutdown is clean and quiet instead of a stack trace.
    import signal
    signal.signal(signal.SIGTERM, signal.default_int_handler)
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        print("ADS-Bit server shutting down.")
