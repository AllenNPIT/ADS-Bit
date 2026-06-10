FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc python3-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    apt-get purge -y gcc python3-dev && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 2001

# Persist config on a mounted volume by default (see docker-compose.yml).
ENV PYTHONUNBUFFERED=1 \
    ADSBIT_CONFIG=/app/data/config.json

# Liveness probe against the unauthenticated /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:2001/health',timeout=4).status==200 else 1)" || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
