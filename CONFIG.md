# Pixel View Configuration Guide

This guide explains how to configure Pixel View for your ADS-B receiver setup.

## Configuration File

Edit `config.json` to customize your installation:

```json
{
  "receivers": "AUTO",
  "receiver_port": 30003,
  "location": {
    "name": "My Location",
    "lat": 0.0,
    "lon": 0.0
  },
  "web_port": 2001,
  "theme": "desert"
}
```

**Important:** You must set your `location.lat` and `location.lon` to your actual receiver coordinates for weather data and aircraft positioning to work correctly.

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `receivers` | string or array | `"AUTO"` to scan network, or IP address(es) of ADS-B receiver(s) |
| `receiver_port` | number | Port for SBS/BaseStation data (default: 30003) |
| `location.name` | string | Display name shown on screen (e.g., "Seattle, WA") |
| `location.lat` | number | Latitude of your receiver location |
| `location.lon` | number | Longitude of your receiver location |
| `web_port` | number | Port for the web interface (default: 2001) |
| `theme` | string | Background theme: `"desert"` (default) or `"custom"` |

### Receiver Configuration Examples

**Auto-scan network (default):**
```json
"receivers": "AUTO"
```

**Single receiver:**
```json
"receivers": "192.168.1.100"
```

**Multiple receivers:**
```json
"receivers": ["192.168.1.100", "192.168.1.101"]
```

---

## Background Themes

Pixel View uses directional background images to show the horizon view from your receiver location. Backgrounds are organized into themes stored in the `backgrounds/` folder.

### Available Themes

| Theme | Description |
|-------|-------------|
| `desert` | Las Vegas desert landscape (default) |
| `custom` | Your own custom backgrounds |

### Theme Folder Structure

```
backgrounds/
├── desert/          # Default desert theme
│   ├── north.png
│   ├── east.png
│   ├── south.png
│   └── west.png
└── custom/          # Your custom backgrounds
    ├── README.md    # Instructions for creating custom backgrounds
    ├── north.png
    ├── east.png
    ├── south.png
    └── west.png
```

### Using Custom Backgrounds

1. Add your background images to `backgrounds/custom/`
2. Set `"theme": "custom"` in your `config.json`
3. Restart the server

### Image Files

Each theme folder needs these 4 directional images:

| File | Direction | Description |
|------|-----------|-------------|
| `north.png` | North (0°) | View looking north from your location |
| `east.png` | East (90°) | View looking east from your location |
| `south.png` | South (180°) | View looking south from your location |
| `west.png` | West (270°) | View looking west from your location |

### Image Requirements

- **Resolution:** 1536 x 1024 pixels (recommended)
- **Format:** PNG with transparency support
- **Aspect ratio:** 3:2 (width:height)
- **Style:** Pixel art style for best visual consistency

### Image Composition

Each background image should include:

1. **Sky area** (top ~60%): Should be transparent or very light to blend with the dynamic sky gradient
2. **Horizon line**: Where the sky meets the ground/landscape
3. **Ground/landscape** (bottom ~40%): Your local terrain features

```
┌─────────────────────────────┐
│                             │
│     Transparent/Sky         │  ← Dynamic sky renders here
│     (alpha = 0 or light)    │
│                             │
├─────────────────────────────┤  ← Horizon line
│                             │
│     Ground/Landscape        │  ← Your local scenery
│     (mountains, buildings,  │
│      trees, desert, etc.)   │
│                             │
└─────────────────────────────┘
```

### Creating Custom Backgrounds

**Option 1: Pixel Art (Recommended)**
- Use a pixel art editor (Aseprite, Piskel, GIMP)
- Create at 384x256 or 768x512, then scale up 4x or 2x
- Keep colors limited for retro aesthetic
- Use the existing backgrounds as templates

**Option 2: Photo-based**
- Take photos looking N/E/S/W from your receiver location
- Apply a pixel art filter or posterize effect
- Reduce to limited color palette
- Resize to 1536x1024

**Option 3: Simplified Silhouettes**
- Create simple horizon silhouettes of local landmarks
- Mountains, buildings, trees as flat shapes
- Works well with limited artistic skills

### Tips for Good Backgrounds

1. **Consistency**: Use the same color palette across all 4 directions
2. **Horizon height**: Keep the horizon at roughly the same vertical position
3. **Landmarks**: Include recognizable local features (mountains, towers, etc.)
4. **Weather**: The sky portion should be transparent so the dynamic weather shows through
5. **Testing**: View each direction in the app to ensure smooth rotation

### Example Color Palettes

**Desert/Southwest:**
```
Ground tones:  #d4a868, #b8884c, #a87840
Rock/mountain: #8c7c68, #6c5c4c
Vegetation:    #54a844, #3c7c30
```

**Forest/Pacific Northwest:**
```
Ground tones:  #3c5c3c, #4c6c4c, #2c4c2c
Trees:         #2c5c2c, #1c4c1c, #3c6c3c
Mountains:     #5c6c7c, #7c8c9c, #fcfcfc (snow)
```

**Urban/City:**
```
Buildings:     #4c5c6c, #5c6c7c, #6c7c8c
Windows:       #fcd444, #fcfc9c
Ground:        #3c3c3c, #4c4c4c
```

**Coastal:**
```
Sand:          #e4d4a8, #d4c498
Water:         #5c94fc, #4c84ec
Cliffs:        #8c7c68, #9c8c78
```

Sky should always be transparent (#00000000) to allow the dynamic sky gradient to show through.

---

## Other Sprite Assets

All sprite images are located in the `images/` folder. These are optional to customize:

| File | Size | Description |
|------|------|-------------|
| `images/sun.png` | 64x64 | Sun sprite |
| `images/moon_6_phases.png` | 192x128 | Moon phases (3x2 grid) |
| `images/happycloud.png` | 96x64 | Clear weather cloud |
| `images/raincloud.png` | 96x64 | Rain/storm cloud |

### Aircraft Sprites

| File | Description |
|------|-------------|
| `images/smallProp.png` | Small propeller aircraft (Cessna) |
| `images/regionalJet.png` | Regional jets (CRJ, ERJ) |
| `images/narrowBody.png` | Narrow body jets (737, A320) |
| `images/wideBody.png` | Wide body jets (777, 787) |
| `images/heavy.png` | Heavy/jumbo jets (747, A380) |
| `images/helicopter.png` | Helicopters |

All aircraft sprites should face **right (east)** - the code flips them automatically for westbound flights.

---

## Quick Start Checklist

1. [ ] Install dependencies: `pip install -r requirements.txt`
2. [ ] Edit `config.json` with your receiver IP (or leave as AUTO)
3. [ ] Set your location name, latitude, and longitude
4. [ ] (Optional) Add custom backgrounds to `backgrounds/custom/` and set `"theme": "custom"`
5. [ ] Start the server: `python3 server.py`
6. [ ] Open browser to `http://your-server-ip:2001`

---

## Running as a Service (Auto-Start)

To run Pixel-ADSB automatically on boot, create a systemd service:

### 1. Create the service file

```bash
sudo nano /etc/systemd/system/pixel-adsb.service
```

Add this content (adjust paths as needed):

```ini
[Unit]
Description=Pixel-ADSB Flight Tracker
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/pixel-view
ExecStart=/usr/bin/python3 /path/to/pixel-view/server.py
Restart=always
RestartSec=5
StandardOutput=append:/var/log/pixel-adsb.log
StandardError=append:/var/log/pixel-adsb.log

[Install]
WantedBy=multi-user.target
```

### 2. Enable and start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable pixel-adsb
sudo systemctl start pixel-adsb
```

### 3. Check status

```bash
sudo systemctl status pixel-adsb
```

### 4. View logs

```bash
tail -f /var/log/pixel-adsb.log
```
