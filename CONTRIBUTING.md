# Contributing to ADS-Bit

Thanks for your interest in improving ADS-Bit! Contributions of all kinds —
bug reports, features, sprites, themes, docs — are welcome.

## Development setup

ADS-Bit is a Python (aiohttp) backend with a vanilla-JavaScript frontend.
There is **no build step** for the frontend.

```bash
git clone <your-fork-url>
cd ADS-Bit
pip install -r requirements.txt      # Python 3.9–3.11 recommended (see note below)
cp config.json.example config.json   # optional; the setup wizard runs otherwise
python3 server.py                     # serves on http://localhost:2001
```

Or with Docker (no local Python needed):

```bash
docker compose up -d
```

> **Python version note:** the `netifaces` dependency can be hard to build on
> Python 3.12+. Use Python 3.9–3.11, or just use the Docker image (Python 3.11).

## Project layout

- `server.py` — aiohttp server: receiver connections, flight state, APIs, auth.
- `ads-bit.js` / `index.html` — Canvas-based retro viewer.
- `admin/` — admin panel, including the in-browser `pixel-editor.js`.
- `setup/` — first-run setup wizard.
- `images/`, `backgrounds/` — sprite and theme assets.

## Conventions

- **Frontend assets are cache-busted** via a `?v=YYYYMMDD[x]` query in
  `admin/admin.html`. If you change `admin.css`, `admin.js`, or
  `pixel-editor.js`, bump that token so browsers reload them.
- The `VERSION` constant in `server.py` is the single source of truth; bump it
  for releases and add a `CHANGELOG.md` entry.
- Keep the retro aesthetic (Press Start 2P, blue/gold palette) for UI work.
- Match the style of surrounding code; no frontend framework or build tooling.

## Submitting changes

1. Fork and create a topic branch (`feature/…`, `fix/…`, `chore/…`).
2. Make focused commits with clear messages.
3. Verify locally: the server starts, the page loads, and your change works.
   For Docker changes, confirm `docker build` succeeds.
4. Open a pull request describing what changed and how you tested it.

CI will byte-compile the server, validate `config.json.example`, and build the
Docker image on every PR.

## Reporting bugs / requesting features

Use the issue templates. For security issues, see [SECURITY.md](SECURITY.md).
