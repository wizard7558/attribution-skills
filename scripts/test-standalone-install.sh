#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v skills-ref >/dev/null 2>&1; then
  echo "SKIP standalone install test: skills-ref not installed" >&2
  exit 0
fi

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/attribution-skills-standalone.XXXXXX")"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

skills=(
  channel-taxonomy
  ga4-bigquery-export
  first-party-pixel
  clickstream-identity-stitching
  crm-attribution-profiler
  crm-paid-attribution
  funnel-truth-and-cost-per-stage
  multi-touch-models-sql
  mmm-and-incrementality-framing
  capi-match-keys
  attribution-data-quality-tripwires
  attribution-audit
)

for skill in "${skills[@]}"; do
  target="$tmpdir/$skill"
  mkdir -p "$target"
  cp -R "skills/$skill/." "$target/"
  case "$skill" in
    channel-taxonomy)
      node "$target/scripts/build-artifacts.mjs" --check
      ;;
    ga4-bigquery-export)
      node "$target/scripts/test-artifacts.mjs"
      ;;
    first-party-pixel)
      node "$target/scripts/taxonomy-parity.mjs"
      ;;
    attribution-audit)
      ;;
  esac
  skills-ref validate "$target"
done

echo "PASS standalone install smoke for ${#skills[@]} skills"
