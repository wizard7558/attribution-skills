#!/usr/bin/env bash
# Smoke: copy the full skills/ tree, then skills-ref validate each skill in that
# isolated checkout. Sibling-aware artifact checks run against the copied tree.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

skills_ref() {
  if command -v skills-ref >/dev/null 2>&1; then
    skills-ref "$@"
  else
    npx --yes skills-ref "$@"
  fi
}

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/attribution-skills-standalone.XXXXXX")"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

cp -R skills "$tmpdir/skills"

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

(
  cd "$tmpdir/skills/channel-taxonomy"
  node scripts/build-artifacts.mjs --check
)
(
  cd "$tmpdir/skills/ga4-bigquery-export"
  # test-artifacts expects skills/ siblings two levels up from scripts/
  node scripts/test-artifacts.mjs
)
(
  cd "$tmpdir/skills/first-party-pixel"
  node scripts/taxonomy-parity.mjs
)

for skill in "${skills[@]}"; do
  skills_ref validate "$tmpdir/skills/$skill"
done

echo "PASS standalone install smoke for ${#skills[@]} skills"
