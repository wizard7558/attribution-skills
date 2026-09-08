#!/usr/bin/env bash
# First-party pixel: end-to-end roundtrip test.
#
# 1. Stands up a Postgres database (a throwaway local cluster if DATABASE_URL
#    is unset, otherwise reuses the database DATABASE_URL points at).
# 2. Applies assets/schema.sql and pixel.ensure_month_partitions().
# 3. Inserts a test site with an empty origin allowlist.
# 4. Starts the node collector adapter (assets/collector/node/server.js)
#    against that database.
# 5. Runs scripts/simulate.mjs to post a realistic event sequence.
# 6. Runs a fixed set of assertion queries and prints PASS/FAIL for each.
# 7. Stops the collector and, if this script started it, the Postgres cluster.
#
# Requires the `pg` npm package to run the node collector adapter (it does
# not vendor a copy). Set NODE_PATH to a directory containing node_modules/pg
# to reuse an existing install; otherwise this script installs one into a
# scratch directory under TMPDIR and reuses it on subsequent runs.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGPORT_TEST="${PGPORT_TEST:-55432}"
COLLECTOR_PORT="${COLLECTOR_PORT:-8787}"
COLLECTOR_URL="http://127.0.0.1:${COLLECTOR_PORT}/collect"

PASS_COUNT=0
FAIL_COUNT=0
SERVER_PID=""
STARTED_CLUSTER=0
PGDATA_DIR=""
RUNTIME_DIR=""

log() { echo "[roundtrip] $*"; }

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    log "stopping collector (pid $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  # PGDATA_DIR may exist even when STARTED_CLUSTER never flipped to 1 (e.g.
  # initdb succeeded but pg_ctl start failed): stop-if-running, then always
  # remove the scratch directory this script allocated, so a failed run
  # never leaks a pgdata directory into $TMPDIR.
  if [[ -n "$PGDATA_DIR" ]]; then
    if [[ "$STARTED_CLUSTER" == "1" ]]; then
      log "stopping throwaway Postgres cluster"
    fi
    "$PG_CTL_BIN" -D "$PGDATA_DIR" -m fast stop >/dev/null 2>&1 || true
    rm -rf "$PGDATA_DIR"
  fi
  if [[ -n "$RUNTIME_DIR" ]]; then
    rm -rf "$RUNTIME_DIR"
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 0. Locate initdb/pg_ctl/psql
# ---------------------------------------------------------------------------
HOMEBREW_PG_BIN="/opt/homebrew/opt/postgresql@17/bin"
if command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1; then
  INITDB_BIN="$(command -v initdb)"
  PG_CTL_BIN="$(command -v pg_ctl)"
elif [[ -x "$HOMEBREW_PG_BIN/initdb" && -x "$HOMEBREW_PG_BIN/pg_ctl" ]]; then
  INITDB_BIN="$HOMEBREW_PG_BIN/initdb"
  PG_CTL_BIN="$HOMEBREW_PG_BIN/pg_ctl"
else
  echo "initdb/pg_ctl not found on PATH or in $HOMEBREW_PG_BIN" >&2
  exit 1
fi
PSQL_BIN="$(command -v psql || echo "$HOMEBREW_PG_BIN/psql")"

# ---------------------------------------------------------------------------
# 1. Database: throwaway cluster, or reuse DATABASE_URL if already set
# ---------------------------------------------------------------------------
if [[ -z "${DATABASE_URL:-}" ]]; then
  PGDATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-roundtrip-pgdata-XXXXXX")"
  log "initializing throwaway Postgres cluster at $PGDATA_DIR (port $PGPORT_TEST)"
  # LC_ALL=C avoids a macOS-specific "postmaster became multithreaded during
  # startup" failure some locale/NSS configurations trigger on listen.
  # TCP-only (no Unix-domain socket): PGDATA_DIR lives under a deeply nested
  # scratch path that can exceed the ~103-byte socket-path limit, so the
  # socket is disabled entirely rather than relocated.
  LC_ALL=C "$INITDB_BIN" -D "$PGDATA_DIR" -U postgres --auth=trust --no-sync >/dev/null
  LC_ALL=C "$PG_CTL_BIN" -D "$PGDATA_DIR" \
    -o "-p $PGPORT_TEST -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
    -l "$PGDATA_DIR/server.log" -w start
  STARTED_CLUSTER=1
  "$PSQL_BIN" -h 127.0.0.1 -p "$PGPORT_TEST" -U postgres -d postgres -c "CREATE DATABASE pixel_test;" >/dev/null
  export DATABASE_URL="postgresql://postgres@127.0.0.1:${PGPORT_TEST}/pixel_test"
else
  log "using existing DATABASE_URL"
fi

PSQL=("$PSQL_BIN" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

# ---------------------------------------------------------------------------
# 2. Schema + partitions + test site
# ---------------------------------------------------------------------------
log "applying schema.sql"
"${PSQL[@]}" -f "$SKILL_DIR/assets/schema.sql" >/dev/null

log "running pixel.ensure_month_partitions()"
"${PSQL[@]}" -c "SELECT pixel.ensure_month_partitions();" >/dev/null

log "seeding test site (empty allowlist)"
"${PSQL[@]}" -c "
  INSERT INTO pixel.sites (site_key, domain, allowed_origins)
  VALUES ('site_test', 'example.com', '{}')
  ON CONFLICT (site_key) DO UPDATE SET allowed_origins = EXCLUDED.allowed_origins;
" >/dev/null

# ---------------------------------------------------------------------------
# 3. Node module resolution for the collector adapter (needs `pg`)
# ---------------------------------------------------------------------------
NODE_MODULES_SOURCE="${NODE_PATH:-}"
if [[ -z "$NODE_MODULES_SOURCE" || ! -d "$NODE_MODULES_SOURCE/node_modules/pg" ]]; then
  DEFAULT_NPM_DIR="${TMPDIR:-/tmp}/first-party-pixel-roundtrip-deps"
  if [[ ! -d "$DEFAULT_NPM_DIR/node_modules/pg" ]]; then
    log "installing 'pg' into $DEFAULT_NPM_DIR (set NODE_PATH to skip this)"
    mkdir -p "$DEFAULT_NPM_DIR"
    (cd "$DEFAULT_NPM_DIR" && npm init -y >/dev/null 2>&1 && npm i pg >/dev/null 2>&1) || {
      echo "Could not install 'pg' automatically. Install it manually:" >&2
      echo "  mkdir -p $DEFAULT_NPM_DIR && cd $DEFAULT_NPM_DIR && npm init -y && npm i pg" >&2
      echo "  then re-run with NODE_PATH=$DEFAULT_NPM_DIR $0" >&2
      exit 1
    }
  fi
  NODE_MODULES_SOURCE="$DEFAULT_NPM_DIR"
fi

# Mirror the repo's assets/ tree into a scratch runtime dir with node_modules
# symlinked alongside it, so Node's ESM resolver (which walks up from the
# importing file, and does not honor NODE_PATH for `import`) finds `pg`
# without ever writing node_modules into the repo itself.
RUNTIME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pixel-roundtrip-runtime-XXXXXX")"
mkdir -p "$RUNTIME_DIR/assets/collector/node"
cp "$SKILL_DIR/assets/pixel.js" "$RUNTIME_DIR/assets/pixel.js"
cp "$SKILL_DIR/assets/collector/core.js" "$RUNTIME_DIR/assets/collector/core.js"
cp "$SKILL_DIR/assets/collector/node/server.js" "$RUNTIME_DIR/assets/collector/node/server.js"
ln -s "$NODE_MODULES_SOURCE/node_modules" "$RUNTIME_DIR/node_modules"
# core.js/server.js use `import`/`export` (ES modules); mark the scratch
# runtime tree as such so Node doesn't fall back to CommonJS parsing. This
# package.json is scratch-only scaffolding, never written into the repo.
echo '{"type":"module"}' > "$RUNTIME_DIR/package.json"

# ---------------------------------------------------------------------------
# 4. Start the collector
# ---------------------------------------------------------------------------
log "starting node collector on :$COLLECTOR_PORT"
PORT="$COLLECTOR_PORT" DATABASE_URL="$DATABASE_URL" PIXEL_IP_SALT="test" \
  node "$RUNTIME_DIR/assets/collector/node/server.js" > "$RUNTIME_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:${COLLECTOR_PORT}/health"; then break; fi
  sleep 0.2
done
if ! curl -s -o /dev/null "http://127.0.0.1:${COLLECTOR_PORT}/health"; then
  echo "collector did not become healthy; log follows:" >&2
  cat "$RUNTIME_DIR/server.log" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. Simulate
# ---------------------------------------------------------------------------
log "running scripts/simulate.mjs"
COLLECTOR_URL="$COLLECTOR_URL" node "$SKILL_DIR/scripts/simulate.mjs"

# ---------------------------------------------------------------------------
# 6. Assertions
# ---------------------------------------------------------------------------
assert_sql() {
  local description="$1"
  local sql="$2"
  local result
  result="$("${PSQL[@]}" -tA -c "$sql" | tr -d '[:space:]')"
  if [[ "$result" == "t" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "PASS: $description"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "FAIL: $description (query returned: $result)"
  fi
}

VISITOR_FILTER="(SELECT id FROM pixel.visitors WHERE site_key = 'site_test' AND visitor_uid = 'visitor-1')"

assert_sql "visitors = 1" \
  "SELECT (count(*) = 1) FROM pixel.visitors WHERE site_key = 'site_test';"

assert_sql "events = 5" \
  "SELECT (count(*) = 5) FROM pixel.events WHERE visitor_id = $VISITOR_FILTER;"

assert_sql "touchpoints = 2 with channels {Paid Search, Direct}" \
  "SELECT (string_agg(channel, ',' ORDER BY occurred_at) = 'Paid Search,Direct')
   FROM pixel.touchpoints WHERE visitor_id = $VISITOR_FILTER;"

assert_sql "contacts = 1 with email_canonical = 'test.user@example.com'" \
  "SELECT (count(*) = 1 AND max(email_canonical) = 'test.user@example.com')
   FROM pixel.contacts WHERE site_key = 'site_test';"

assert_sql "identity_links = 1" \
  "SELECT (count(*) = 1) FROM pixel.identity_links WHERE visitor_id = $VISITOR_FILTER;"

assert_sql "both touchpoints have contact_id set (back-fill)" \
  "SELECT (count(*) = 0) FROM pixel.touchpoints WHERE visitor_id = $VISITOR_FILTER AND contact_id IS NULL;"

assert_sql "conversion_events = 2" \
  "SELECT (count(*) = 2) FROM pixel.conversion_events WHERE visitor_id = $VISITOR_FILTER;"

assert_sql "sessions = 2 rows: Paid Search (2 pageviews, gclid=TEST123) then Direct" \
  "SELECT (string_agg(channel || ':' || pageviews || ':' || COALESCE(landing_gclid, '-'), '|' ORDER BY session_start_ts)
           = 'Paid Search:2:TEST123|Direct:1:-')
   FROM pixel.sessions WHERE visitor_id = $VISITOR_FILTER;"

assert_sql "channel_daily: Paid Search + Direct conversions sum to 2, conversion_value = 49" \
  "SELECT (COALESCE(SUM(conversions), 0) = 2 AND COALESCE(SUM(conversion_value), 0) = 49)
   FROM pixel.channel_daily WHERE channel IN ('Paid Search', 'Direct');"

echo ""
echo "[roundtrip] $PASS_COUNT passed, $FAIL_COUNT failed"
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
