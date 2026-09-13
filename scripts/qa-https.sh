#!/usr/bin/env bash
set -euo pipefail
umask 077
CMON_CADDY_BIN="${CADDY_BIN:-caddy}"
CMON_TLS_DIR="$(pwd)/.cache/transport/run"
mkdir -p "$CMON_TLS_DIR"
command -v "$CMON_CADDY_BIN" >/dev/null || { echo 'CADDY_BIN must point to Caddy 2.11.4 or later.'; exit 1; }
test -n "${TEST_DATABASE_URL:-}" || { echo 'TEST_DATABASE_URL is required.'; exit 1; }
npm run build
npx vite build --ssr tests/performance/server.ts --outDir .cache/performance/harness
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
  -keyout "$CMON_TLS_DIR/key.pem" -out "$CMON_TLS_DIR/cert.pem" >"$CMON_TLS_DIR/certificate.log" 2>&1
cat > "$CMON_TLS_DIR/Caddyfile" <<EOF
{
  admin off
  auto_https off
}
import "$(pwd)/deploy/proxy.caddy"
https://127.0.0.1:3443 {
  bind 127.0.0.1
  tls "$CMON_TLS_DIR/cert.pem" "$CMON_TLS_DIR/key.pem"
  import cmon_app
}
EOF
CMON_APP_PID=''
CMON_PROXY_PID=''
cleanup() {
  test -z "$CMON_PROXY_PID" || kill "$CMON_PROXY_PID" 2>/dev/null || true
  test -z "$CMON_APP_PID" || kill "$CMON_APP_PID" 2>/dev/null || true
  wait || true
}
trap cleanup EXIT INT TERM
NODE_ENV=production PERF_PORT=3130 PERF_PUBLIC_ORIGIN=https://127.0.0.1:3443 PERF_SSR_DEADLINE_MS=20000 PERF_DATASET=load \
  node .cache/performance/harness/server.js > "$CMON_TLS_DIR/app.log" 2>&1 &
CMON_APP_PID=$!
XDG_CONFIG_HOME="$CMON_TLS_DIR/config" XDG_DATA_HOME="$CMON_TLS_DIR/data" CMON_UPSTREAM=127.0.0.1:3130 "$CMON_CADDY_BIN" run --config "$CMON_TLS_DIR/Caddyfile" --adapter caddyfile > "$CMON_TLS_DIR/proxy.log" 2>&1 &
CMON_PROXY_PID=$!
TRANSPORT_CA="$CMON_TLS_DIR/cert.pem" node tests/performance/transport.mjs
if test "${CMON_LOAD:-0}" = 1; then
  TRANSPORT_CA="$CMON_TLS_DIR/cert.pem" node tests/performance/load.mjs
fi
