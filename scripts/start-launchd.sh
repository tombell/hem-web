#!/usr/bin/env bash
set -euo pipefail

cd /Users/tombell/Workspace/hem-web

set -a
if [ -f /Users/tombell/.config/hem-web/env ]; then
  # shellcheck disable=SC1091
  source /Users/tombell/.config/hem-web/env
fi
if [ -f /Users/tombell/Workspace/hem-web/.env ]; then
  # shellcheck disable=SC1091
  source /Users/tombell/Workspace/hem-web/.env
fi
set +a

export PATH="/Users/tombell/.local/share/mise/installs/node/lts/bin:/Users/tombell/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec /Users/tombell/.local/share/mise/installs/node/lts/bin/pnpm start
