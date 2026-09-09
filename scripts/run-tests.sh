#!/usr/bin/env bash
# Repository checks. Default: local deterministic tests only, without cloud/model calls.
# Usage: bash scripts/run-tests.sh [--offline] [--postgres] [--bigquery]
# Flags select independent suites; combine them explicitly to run more than one.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ $# -eq 0 ]]; then
  set -- --offline
fi

for suite in "$@"; do
  case "$suite" in
    --offline)
      python3 scripts/test-confidential.py
      node skills/channel-taxonomy/scripts/build-artifacts.mjs --repository --check
      node skills/channel-taxonomy/scripts/run-checks.mjs
      node skills/ga4-bigquery-export/scripts/test-integration.mjs
      node skills/ga4-bigquery-export/scripts/test-artifacts.mjs
      node skills/first-party-pixel/scripts/taxonomy-parity.mjs
      python3 skills/channel-taxonomy/scripts/run-model-evals.py --self-test
      ;;
    --postgres)
      # Make Linux PostgreSQL server binaries available without running initdb as root.
      if command -v pg_config >/dev/null 2>&1; then
        export PATH="$(pg_config --bindir):$PATH"
      fi
      # Each suite creates and cleans up its own cluster; never reuse an inherited database.
      echo "Running standalone collector roundtrip"
      env -u DATABASE_URL \
        PGPORT_TEST="${PGPORT_TEST:-55439}" COLLECTOR_PORT="${COLLECTOR_PORT:-8799}" \
        bash skills/first-party-pixel/scripts/roundtrip.sh
      echo "Running repository legacy-schema migration roundtrip"
      env -u DATABASE_URL \
        PGPORT_TEST="${PGPORT_TEST:-55439}" COLLECTOR_PORT="${COLLECTOR_PORT:-8799}" \
        bash skills/first-party-pixel/scripts/roundtrip.sh --migration
      ;;
    --bigquery)
      bash skills/ga4-bigquery-export/scripts/run_checks.sh --synthetic
      ;;
    --help|-h)
      echo 'Usage: bash scripts/run-tests.sh [--offline] [--postgres] [--bigquery]'
      echo 'Default --offline: local fixtures, artifact checks, and model scorer self-tests.'
      echo '--postgres: separate standalone and repository migration roundtrips; PostgreSQL, npm, and git history required.'
      echo '--bigquery: actual GA4 templates on synthetic events; authenticated bq required.'
      ;;
    *)
      echo "Unknown suite: $suite" >&2
      exit 2
      ;;
  esac
done
