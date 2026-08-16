#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${HEM_WEB_PROJECT_DIR:-$(dirname -- "$SCRIPT_DIR")}"
ENV_FILE="${HEM_WEB_ENV_FILE:-$HOME/.config/hem-web/env}"
PROJECT_ENV_FILE="${HEM_WEB_PROJECT_ENV_FILE:-$PROJECT_DIR/.env}"

cd "$PROJECT_DIR"

set -a
for env_file in "$ENV_FILE" "$PROJECT_ENV_FILE"; do
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
  fi
done
set +a

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

if [[ -n "${NODE_BIN:-}" ]]; then
  exec "$NODE_BIN" src/server.ts
fi

if [[ -n "${MISE_BIN:-}" ]]; then
  NODE_BIN="$($MISE_BIN which node)"
  exec "$NODE_BIN" src/server.ts
fi

if command -v mise >/dev/null 2>&1; then
  NODE_BIN="$(mise which node)"
  exec "$NODE_BIN" src/server.ts
fi

if command -v node >/dev/null 2>&1; then
  exec "$(command -v node)" src/server.ts
fi

printf 'hem-web: neither mise nor node was found; set MISE_BIN or NODE_BIN\n' >&2
exit 127
