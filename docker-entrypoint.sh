#!/bin/sh
# Seed a config file on first run so `docker compose up` works on a fresh
# clone with no manual steps. The config lives on a mounted data volume so it
# persists across container rebuilds.
set -e

: "${ADSBIT_CONFIG:=/app/config.json}"
CONFIG_DIR=$(dirname "$ADSBIT_CONFIG")
mkdir -p "$CONFIG_DIR"

if [ ! -f "$ADSBIT_CONFIG" ]; then
    echo "[entrypoint] No config at $ADSBIT_CONFIG — seeding from config.json.example"
    cp /app/config.json.example "$ADSBIT_CONFIG"
fi

exec python3 server.py
