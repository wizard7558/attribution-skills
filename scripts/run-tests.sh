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

      python3 scripts/run-skill-evals.py --self-test
      python3 scripts/test-skill-evals.py
      for skill in skills/*/; do
        if [[ -f "${skill}references/eval-cases.json" ]]; then
          python3 scripts/run-skill-evals.py --skill "$skill"
        fi
      done

      node scripts/test-suite-contracts.mjs
      node scripts/test-sql-rendering.mjs

      node skills/channel-taxonomy/scripts/test-eval-manifest.mjs
      node skills/ga4-bigquery-export/scripts/test-eval-manifest.mjs
      node skills/clickstream-identity-stitching/scripts/test-eval-manifest.mjs
      node skills/crm-attribution-profiler/scripts/test-eval-cases.mjs
      node skills/crm-paid-attribution/scripts/test-eval-cases.mjs
      node skills/funnel-truth-and-cost-per-stage/scripts/test-eval-cases.mjs
      node skills/capi-match-keys/scripts/test-eval-manifest.mjs
      node skills/attribution-data-quality-tripwires/scripts/test-eval-manifest.mjs
      python3 scripts/test-publish-eval-matrix.py
      bash scripts/test-standalone-install.sh

      node skills/first-party-pixel/scripts/build-eval-cases.mjs --check
      node skills/first-party-pixel/scripts/test-eval-manifest.mjs
      node skills/attribution-audit/scripts/build-eval-cases.mjs --check
      node skills/attribution-audit/scripts/test-eval-manifest.mjs

      node skills/attribution-audit/scripts/test-compose-audit.mjs
      node skills/attribution-audit/scripts/test-execute-audit.mjs
      node skills/attribution-audit/scripts/test-execute-audit-bigquery.mjs
      node skills/attribution-audit/scripts/test-execute-audit-python.mjs
      node skills/attribution-audit/scripts/test-audit-bigquery-transport.mjs
      node skills/attribution-audit/scripts/test-render-audit-sql.mjs

      node skills/attribution-data-quality-tripwires/scripts/test-reconciliation.mjs
      node skills/attribution-data-quality-tripwires/scripts/test-population-checks.mjs
      node skills/attribution-data-quality-tripwires/scripts/test-schema-checks.mjs
      node skills/attribution-data-quality-tripwires/scripts/test-empty-columns.mjs
      node skills/attribution-data-quality-tripwires/scripts/test-deleted-ad-coverage.mjs

      node skills/clickstream-identity-stitching/scripts/test-primitives.mjs
      node skills/clickstream-identity-stitching/scripts/test-graph.mjs
      node skills/clickstream-identity-stitching/scripts/test-webhook.mjs
      node skills/clickstream-identity-stitching/scripts/test-identity-artifacts.mjs

      node skills/crm-attribution-profiler/scripts/run-checks.mjs
      node skills/crm-paid-attribution/scripts/test-sql.mjs

      node skills/funnel-truth-and-cost-per-stage/scripts/test-stage-truth.mjs
      node skills/funnel-truth-and-cost-per-stage/scripts/test-cost-per-stage.mjs
      node skills/funnel-truth-and-cost-per-stage/scripts/test-refresh-partitions.mjs

      node skills/multi-touch-models-sql/scripts/test-credit-ledger.mjs
      node skills/multi-touch-models-sql/scripts/test-attribution-metrics.mjs

      node skills/capi-match-keys/scripts/test-conversion-events.mjs
      node skills/capi-match-keys/scripts/test-match-keys.mjs
      node skills/capi-match-keys/scripts/test-provider-payloads.mjs

      python3 -B skills/mmm-and-incrementality-framing/scripts/build-eval-cases.py --check
      python3 -B skills/mmm-and-incrementality-framing/scripts/test-eval-cases.py
      python3 -B skills/mmm-and-incrementality-framing/scripts/test_weekly_mlr.py
      python3 -B skills/mmm-and-incrementality-framing/scripts/test_response_curves.py
      python3 -B skills/mmm-and-incrementality-framing/scripts/test_framing.py

      node skills/first-party-pixel/scripts/test-identity-projection.mjs
      node skills/first-party-pixel/scripts/test-identity-snapshot.mjs
      node skills/first-party-pixel/scripts/test-identity-capture.mjs
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
      if [[ -f skills/capi-match-keys/scripts/test-conversion-outbox.sh ]]; then
        bash skills/capi-match-keys/scripts/test-conversion-outbox.sh
      fi
      ;;
    --bigquery)
      bash skills/ga4-bigquery-export/scripts/run_checks.sh --synthetic
      ;;
    --help|-h)
      echo 'Usage: bash scripts/run-tests.sh [--offline] [--postgres] [--bigquery]'
      echo 'Default --offline: local fixtures, artifact checks, shared harness validation, and per-skill deterministic tests (Node 22+ recommended).'
      echo '--postgres: separate standalone and repository migration roundtrips plus CAPI outbox harness; PostgreSQL, npm, and git history required.'
      echo '--bigquery: actual GA4 templates on synthetic events; authenticated bq required.'
      ;;
    *)
      echo "Unknown suite: $suite" >&2
      exit 2
      ;;
  esac
done
