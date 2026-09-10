#!/usr/bin/env bash
# Four positional arguments remain supported; all validation/rendering is in Node.
set -euo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/run-export-checks.mjs" "$@"
