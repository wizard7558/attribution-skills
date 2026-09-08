#!/usr/bin/env bash
# Fails the build if the tracked tree contains signs of leaked real customer
# or company data: real GA4 property ids, the internal GCP project name,
# email addresses, or a term from a private local denylist.
#
# The denylist at $HOME/.config/attribution-skills/denylist.txt is a private,
# local-only list of client/company names and identifiers. It is never
# committed to this repository and is not required to exist — if it is
# missing, that check is skipped.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail=0
tmp_files="$(mktemp)"
trap 'rm -f "$tmp_files"' EXIT

# Tracked files only, excluding this script itself (it necessarily contains
# the patterns it searches for).
git ls-files | grep -v '^scripts/check-confidential.sh$' > "$tmp_files" || true

report() {
  local label="$1"
  local matches="$2"
  if [ -n "$matches" ]; then
    echo "CONFIDENTIALITY CHECK FAILED: $label"
    echo "$matches"
    echo
    fail=1
  fi
}

if [ -s "$tmp_files" ]; then
  # Note: files are piped to xargs on stdin, not via `xargs -a`, because
  # BSD xargs (macOS) does not support the GNU `-a` flag.

  # 1. Real GA4 property ids in dataset names, e.g. analytics_123456.
  #    Placeholders like analytics_PROPERTY_ID must pass.
  matches="$(xargs grep -nHE 'analytics_[0-9]{6,}' -- < "$tmp_files" 2>/dev/null || true)"
  report "real GA4 property id (analytics_[0-9]{6,})" "$matches"

  # 2. Internal GCP project name.
  matches="$(xargs grep -nHF 'res-analytics' -- < "$tmp_files" 2>/dev/null || true)"
  report "internal project name (res-analytics)" "$matches"

  # 3. Email addresses, excluding example.com.
  matches="$(xargs grep -nHE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' -- < "$tmp_files" 2>/dev/null | grep -viE '@example\.com' || true)"
  report "email address" "$matches"

  # 4. Private local denylist (client/company names, ids). Never committed.
  denylist="$HOME/.config/attribution-skills/denylist.txt"
  if [ -f "$denylist" ]; then
    while IFS= read -r term; do
      [ -z "$term" ] && continue
      matches="$(xargs grep -nHiF -- "$term" < "$tmp_files" 2>/dev/null || true)"
      report "denylisted term ($term)" "$matches"
    done < "$denylist"
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "One or more confidentiality checks failed. Remove the offending content before committing."
  exit 1
fi

echo "Confidentiality check passed."
