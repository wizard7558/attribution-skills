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
MIGRATION_MODE=0
if [[ "${1:-}" == "--migration" ]]; then
  MIGRATION_MODE=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--migration]" >&2
  exit 2
fi
PGPORT_TEST="${PGPORT_TEST:-$((55000 + RANDOM % 1000))}"
COLLECTOR_PORT="${COLLECTOR_PORT:-$((18000 + RANDOM % 1000))}"
COLLECTOR_URL="http://127.0.0.1:${COLLECTOR_PORT}/collect"

PASS_COUNT=0
FAIL_COUNT=0
SERVER_PID=""
STARTED_CLUSTER=0
PGDATA_DIR=""
RUNTIME_DIR=""
BASELINE_SCHEMA_PATH=""

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
  if [[ -n "$BASELINE_SCHEMA_PATH" ]]; then
    rm -f "$BASELINE_SCHEMA_PATH"
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
# 2. Current schema + partitions + test sites; --migration adds a historical upgrade proof
# ---------------------------------------------------------------------------
if [[ "$MIGRATION_MODE" == "1" ]]; then
  if ! git -C "$SKILL_DIR" rev-parse --verify 2c240a3^{commit} >/dev/null 2>&1; then
    echo "--migration requires git history containing commit 2c240a3" >&2
    exit 2
  fi
  BASELINE_SCHEMA_PATH="$(mktemp "${TMPDIR:-/tmp}/pixel-baseline-schema-XXXXXX.sql")"
  git -C "$SKILL_DIR" show 2c240a3:skills/first-party-pixel/assets/schema.sql > "$BASELINE_SCHEMA_PATH"
  log "applying baseline schema for migration proof"
  "${PSQL[@]}" -f "$BASELINE_SCHEMA_PATH" >/dev/null
  "${PSQL[@]}" -c "SELECT pixel.ensure_month_partitions();" >/dev/null
  "${PSQL[@]}" -c "
    INSERT INTO pixel.sites (site_key, domain, allowed_origins) VALUES ('site_legacy', 'legacy.example.com', '{}');
    INSERT INTO pixel.visitors (site_key, visitor_uid, first_seen_at, last_seen_at)
    VALUES ('site_legacy', 'visitor-legacy', '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z');
    INSERT INTO pixel.events (site_key, visitor_id, event_type, url, occurred_at)
    SELECT 'site_legacy', id, 'pageview', 'https://legacy.example.com/', '2026-09-01T12:00:00Z'
    FROM pixel.visitors WHERE site_key = 'site_legacy' AND visitor_uid = 'visitor-legacy';
    INSERT INTO pixel.touchpoints (site_key, visitor_id, channel, occurred_at)
    SELECT 'site_legacy', id, 'Display', '2026-09-01T12:00:00Z'
    FROM pixel.visitors WHERE site_key = 'site_legacy' AND visitor_uid = 'visitor-legacy';
  " >/dev/null
fi
log "applying schema.sql"
"${PSQL[@]}" -f "$SKILL_DIR/assets/schema.sql" >/dev/null
log "reapplying schema.sql for idempotence"
"${PSQL[@]}" -f "$SKILL_DIR/assets/schema.sql" >/dev/null

assert_migration_sql() {
  local description="$1"
  local sql="$2"
  local result
  result="$(${PSQL[@]} -tA -c "$sql" | tr -d '[:space:]')"
  if [[ "$result" == "t" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1)); echo "PASS: $description"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1)); echo "FAIL: $description (query returned: $result)"
  fi
}
if [[ "$MIGRATION_MODE" == "1" ]]; then
  assert_migration_sql "legacy row remains NULL and maps Display to Paid Other" \
    "SELECT (t.taxonomy_version IS NULL AND s.channel = 'Paid Other' AND s.native_channel = 'Display' AND s.taxonomy_version = 'legacy')
     FROM pixel.touchpoints t JOIN pixel.sessions s ON s.source_scope = 'site_legacy' AND s.visitor_key = t.visitor_id::text
     WHERE t.site_key = 'site_legacy' AND t.channel = 'Display';"
  assert_migration_sql "historical session columns remain first and new aliases append" \
    "SELECT (min(ordinal_position) FILTER (WHERE column_name = 'session_key') = 1
             AND min(ordinal_position) FILTER (WHERE column_name = 'visitor_id') = 2
             AND min(ordinal_position) FILTER (WHERE column_name = 'session_number') = 3
             AND min(ordinal_position) FILTER (WHERE column_name = 'is_new_visitor') = 4
             AND min(ordinal_position) FILTER (WHERE column_name = 'native_channel') = 22
             AND min(ordinal_position) FILTER (WHERE column_name = 'taxonomy_version') = 23
             AND min(ordinal_position) FILTER (WHERE column_name = 'attribution_basis') = 24
             AND min(ordinal_position) FILTER (WHERE column_name = 'source_system') = 25)
     FROM information_schema.columns WHERE table_schema = 'pixel' AND table_name = 'sessions';"
fi

log "running pixel.ensure_month_partitions()"
"${PSQL[@]}" -c "SELECT pixel.ensure_month_partitions();" >/dev/null

log "seeding test site (empty allowlist)"
"${PSQL[@]}" -c "
  INSERT INTO pixel.sites (site_key, domain, allowed_origins)
  VALUES ('site_test', 'example.com', '{}'), ('site_second', 'example.com', '{}'), ('site_mix', 'example.com', '{}'), ('site_mix_sessions', 'example.com', '{}'), ('site_unknown_currency', 'example.com', '{}')
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
cp "$SKILL_DIR/assets/collector/channel-taxonomy.mjs" "$RUNTIME_DIR/assets/collector/channel-taxonomy.mjs"
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

# Simulate a pre-taxonomy row to prove the upgrade path keeps its version NULL
# and lets the session view apply the documented legacy mapping.
"${PSQL[@]}" -c "
  INSERT INTO pixel.touchpoints (site_key, visitor_id, channel, occurred_at)
  VALUES ('site_test', (SELECT id FROM pixel.visitors WHERE site_key = 'site_test' AND visitor_uid = 'visitor-unknown'), 'Display', '2026-09-02T12:00:00Z');
" >/dev/null

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
  "SELECT (count(*) = 1) FROM pixel.visitors WHERE site_key = 'site_test' AND visitor_uid = 'visitor-1';"

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
   FROM pixel.channel_daily WHERE source_scope = 'site_test' AND channel IN ('Paid Search', 'Direct');"

assert_sql "dclid is Paid Other and srsltid is retained" \
  "SELECT (channel = 'Paid Other' AND dclid = 'DCLID123' AND srsltid = 'SEARCH123' AND taxonomy_version = '0.1.0')
   FROM pixel.touchpoints WHERE visitor_id = (SELECT id FROM pixel.visitors WHERE site_key = 'site_second' AND visitor_uid = 'visitor-dclid');"

assert_sql "sessions retain all click IDs including srsltid" \
  "SELECT (click_ids->>'gclid' = 'GCLID123' AND click_ids->>'gbraid' = 'GBRAID123' AND click_ids->>'wbraid' = 'WBRAID123'
           AND click_ids->>'dclid' = 'DCLID123' AND click_ids->>'fbclid' = 'FBCLID123' AND click_ids->>'ttclid' = 'TTCLID123'
           AND click_ids->>'rdt_cid' = 'RDTCID123' AND click_ids->>'li_fat_id' = 'LIFAT123' AND click_ids->>'msclkid' = 'MSCLKID123'
           AND click_ids->>'twclid' = 'TWCLID123' AND click_ids->>'epik' = 'EPIK123' AND click_ids->>'sccid' = 'SCCID123'
           AND click_ids->>'srsltid' = 'SEARCH123')
   FROM pixel.sessions WHERE source_scope = 'site_second' AND visitor_key = (SELECT id::text FROM pixel.visitors WHERE site_key = 'site_second' AND visitor_uid = 'visitor-dclid');"

assert_sql "legacy touchpoint version remains NULL" \
  "SELECT (count(*) > 0 AND bool_and(taxonomy_version IS NULL)) FROM pixel.touchpoints WHERE channel = 'Display';"

assert_sql "affiliate and unknown source channels use canonical labels" \
  "SELECT (count(*) FILTER (WHERE channel = 'Affiliate') = 1 AND count(*) FILTER (WHERE channel = 'Other') = 1)
   FROM pixel.touchpoints WHERE visitor_id IN (SELECT id FROM pixel.visitors WHERE visitor_uid IN ('visitor-affiliate', 'visitor-unknown'));"

assert_sql "two conversions in one session do not fan out sessions" \
  "SELECT (count(DISTINCT s.session_key) = 1 AND max(d.sessions) = 1 AND bool_or(s.engaged) AND bool_or(s.is_new_user) AND max(d.conversions) = 2) FROM pixel.sessions s
   JOIN pixel.channel_daily d ON d.source_scope = 'site_mix' AND d.channel = s.channel
   WHERE s.visitor_id = (SELECT id FROM pixel.visitors WHERE site_key = 'site_mix' AND visitor_uid = 'visitor-mix');"

assert_sql "mixed USD/EUR value is NULL with mixed_currency status" \
  "SELECT (conversion_value IS NULL AND conversion_value_status = 'mixed_currency' AND currency IS NULL)
   FROM pixel.channel_daily WHERE source_scope = 'site_mix' AND channel = 'Paid Search';"

assert_sql "known plus missing/blank currency is NULL with unknown status" \
  "SELECT (sessions = 1 AND conversions = 2 AND conversion_value IS NULL AND conversion_value_status = 'unknown' AND currency IS NULL)
   FROM pixel.channel_daily WHERE source_scope = 'site_unknown_currency' AND channel = 'Paid Search';"

assert_sql "mixed currency across two sessions counts both sessions and conversions once" \
  "SELECT (sessions = 2 AND conversions = 2 AND conversion_value IS NULL AND conversion_value_status = 'mixed_currency')
   FROM pixel.channel_daily WHERE source_scope = 'site_mix_sessions' AND channel = 'Paid Search';"

assert_sql "new shared aliases and source scope are present" \
  "SELECT (new_users = 1 AND key_events = conversions AND source_system = 'first_party_pixel' AND attribution_basis = 'first_touch')
   FROM pixel.channel_daily WHERE source_scope = 'site_test' AND channel = 'Paid Search';"

echo ""
echo "[roundtrip] $PASS_COUNT passed, $FAIL_COUNT failed"
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
