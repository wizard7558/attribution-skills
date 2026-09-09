#!/usr/bin/env bash
# Always owns a new local cluster. DATABASE_URL and PG* connection defaults are ignored.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="/opt/homebrew/opt/postgresql@17/bin"
if [[ ! -x "$PG_BIN/initdb" ]]; then PG_BIN="$(dirname "$(command -v initdb)")"; fi
for binary in initdb pg_ctl psql; do [[ -x "$PG_BIN/$binary" ]] || { echo "PostgreSQL tools unavailable" >&2; exit 1; }; done
RUNTIME_DIR="$(mktemp -d /tmp/capi-outbox-test-XXXXXX)"
CLUSTER_DIR="$RUNTIME_DIR/cluster"
EVIDENCE_DIR="$HOME/Downloads"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_PATH="$EVIDENCE_DIR/capi-conversion-outbox-evidence-$(date -u +%Y%m%dT%H%M%SZ).json"
TEST_PORT=""
cleanup() {
  local original_status=$?
  trap - EXIT
  local stopped=false
  "$PG_BIN/pg_ctl" -D "$CLUSTER_DIR" -m fast -w stop >/dev/null 2>&1 || true
  if ! "$PG_BIN/pg_ctl" -D "$CLUSTER_DIR" status >/dev/null 2>&1; then stopped=true; fi
  rm -rf -- "$RUNTIME_DIR"
  node --input-type=module - "$EVIDENCE_PATH" "$stopped" "$RUNTIME_DIR" "$TEST_PORT" "$original_status" <<'JS'
import fs from 'node:fs';
import net from 'node:net';
const [path, stopped, scratch, port, exitStatus] = process.argv.slice(2);
const refused = !port || await new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
  socket.on('connect', () => { socket.destroy(); resolve(false); });
  socket.on('error', () => resolve(true));
  socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
});
const evidence = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : { status: 'failed_before_tests' };
evidence.cleanup = { cluster_stopped: stopped === 'true', scratch_removed: !fs.existsSync(scratch), loopback_port_closed: refused };
evidence.exit_status = Number(exitStatus);
fs.writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n');
if (!Object.values(evidence.cleanup).every(Boolean)) process.exitCode = 1;
JS
  local cleanup_status=$?
  echo "Evidence: $EVIDENCE_PATH"
  if [[ "$cleanup_status" != 0 ]]; then exit "$cleanup_status"; fi
  exit "$original_status"
}
trap cleanup EXIT
TEST_PORT="$(node --input-type=module - <<'JS'
import net from 'node:net';
const server = net.createServer();
server.listen(0, '127.0.0.1', () => { console.log(server.address().port); server.close(); });
JS
)"
LC_ALL=C "$PG_BIN/initdb" -D "$CLUSTER_DIR" -U postgres --encoding=UTF8 --auth=trust --no-sync >/dev/null
LC_ALL=C "$PG_BIN/pg_ctl" -D "$CLUSTER_DIR" -o "-p $TEST_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c log_statement=none -c log_min_error_statement=panic" -l "$RUNTIME_DIR/server.log" -w start >/dev/null
printf '%s\n' '{"private":true}' > "$RUNTIME_DIR/package.json"
npm install --prefix "$RUNTIME_DIR" --save-exact --ignore-scripts --no-audit --no-fund pg@8.16.3 >/dev/null 2>&1
export CAPI_OUTBOX_RUNTIME="$RUNTIME_DIR" CAPI_OUTBOX_CLUSTER="$CLUSTER_DIR" CAPI_OUTBOX_PORT="$TEST_PORT" CAPI_OUTBOX_EVIDENCE="$EVIDENCE_PATH"
node "$SKILL_DIR/scripts/test-conversion-outbox.mjs"
node "$SKILL_DIR/scripts/test-provider-outbox.mjs"
