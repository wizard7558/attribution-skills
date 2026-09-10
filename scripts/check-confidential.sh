#!/usr/bin/env bash
# Current Git-selected worktree bytes; Python preserves every filename byte.
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/check-confidential.py" "$@"
