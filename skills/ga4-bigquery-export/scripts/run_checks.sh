#!/usr/bin/env bash
# Run every reference SQL file in references/sql/ against a real GA4 BigQuery
# export dataset, substituting the PROJECT.analytics_PROPERTY_ID and
# _TABLE_SUFFIX placeholders, and print a pass/fail summary.
#
# Usage:
#   scripts/run_checks.sh PROJECT DATASET START_YYYYMMDD END_YYYYMMDD
#   scripts/run_checks.sh --synthetic  # actual templates, synthetic events only
#
# Example:
#   scripts/run_checks.sh my-gcp-project analytics_PROPERTY_ID 20260829 20260831
#
# Environment:
#   MAX_BYTES  Optional. Bytes cap passed to --maximum_bytes_billed.
#              Defaults to 5000000000 (5 GB).
#
# Requires the `bq` CLI to be installed and authenticated with access to the
# target project. Never writes substituted SQL back into this repository -
# all substitution happens in a temp directory that is cleaned up on exit.

set -euo pipefail

if [[ "${1:-}" == "--synthetic" && $# -eq 1 ]]; then
  exec node "$(dirname "${BASH_SOURCE[0]}")/test-integration.mjs" --bigquery
fi

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 PROJECT DATASET START_YYYYMMDD END_YYYYMMDD | --synthetic" >&2
  exit 1
fi

PROJECT="$1"
DATASET="$2"
START_DATE="$3"
END_DATE="$4"
MAX_BYTES="${MAX_BYTES:-5000000000}"

if ! [[ "$START_DATE" =~ ^[0-9]{8}$ && "$END_DATE" =~ ^[0-9]{8}$ ]]; then
  echo "START_YYYYMMDD and END_YYYYMMDD must each be 8 digits (e.g. 20260829)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$SCRIPT_DIR/../references/sql"

if [[ ! -d "$SQL_DIR" ]]; then
  echo "Could not find references/sql next to this script (looked in $SQL_DIR)" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Running reference SQL against ${PROJECT}.${DATASET}, window ${START_DATE}-${END_DATE}"
echo "Byte cap: ${MAX_BYTES}"
echo

pass_count=0
fail_count=0

for sql_file in "$SQL_DIR"/*.sql; do
  name="$(basename "$sql_file")"
  substituted="$TMP_DIR/$name"

  sed \
    -e "s/PROJECT\.analytics_PROPERTY_ID/${PROJECT}.${DATASET}/g" \
    -e "s/'YYYYMMDD' AND 'YYYYMMDD'/'${START_DATE}' AND '${END_DATE}'/g" \
    "$sql_file" > "$substituted"

  output_file="$TMP_DIR/${name}.out"
  if bq query \
      --use_legacy_sql=false \
      --maximum_bytes_billed="$MAX_BYTES" \
      --format=csv \
      --max_rows=5 \
      < "$substituted" > "$output_file" 2>&1; then
    echo "PASS  $name"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL  $name"
    grep -i "error" "$output_file" | head -3 | sed 's/^/      /'
    fail_count=$((fail_count + 1))
  fi
done

echo
echo "Summary: ${pass_count} passed, ${fail_count} failed"

if [[ "$fail_count" -gt 0 ]]; then
  exit 1
fi
