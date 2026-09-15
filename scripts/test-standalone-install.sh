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
  budget-scenario-planning
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

# Simulate `npx skills add ... --skill ga4-bigquery-export`: only the single skill
# directory is copied, with no siblings and no repo-level scripts/ directory.
mkdir -p "$tmpdir/single"
cp -R skills/ga4-bigquery-export "$tmpdir/single/ga4-bigquery-export"
(
  cd "$tmpdir/single/ga4-bigquery-export"
  node scripts/test-integration.mjs
  node scripts/test-ecommerce.mjs
  node scripts/test-export-checks.mjs
  node scripts/test-parameter-diagnostics.mjs

  artifacts_out="$(node scripts/test-artifacts.mjs)"
  echo "$artifacts_out" | grep -q '^SKIP ' || { echo "expected SKIP from test-artifacts.mjs in single-skill install" >&2; exit 1; }

  companion_out="$(node scripts/test-companion-sessions.mjs)"
  echo "$companion_out" | grep -q '^SKIP ' || { echo "expected SKIP from test-companion-sessions.mjs in single-skill install" >&2; exit 1; }

  eval_out="$(env -u GA4_EVAL_HARNESS node scripts/test-eval-manifest.mjs)"
  echo "$eval_out" | grep -q '^SKIP ' || { echo "expected SKIP from test-eval-manifest.mjs in single-skill install" >&2; exit 1; }
)
echo "PASS single-skill ga4-bigquery-export install simulation"

for skill in "${skills[@]}"; do
  skills_ref validate "$tmpdir/skills/$skill"
done

echo "PASS standalone install smoke for ${#skills[@]} skills"
