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

if [[ -n "${PNPM_BIN:-}" ]]; then
  exec "$PNPM_BIN" start
fi

if [[ -n "${MISE_BIN:-}" ]]; then
  exec "$MISE_BIN" exec -- pnpm start
fi

if command -v mise >/dev/null 2>&1; then
  exec "$(command -v mise)" exec -- pnpm start
fi

if command -v pnpm >/dev/null 2>&1; then
  exec "$(command -v pnpm)" start
fi

printf 'hem-web: neither mise nor pnpm was found; set MISE_BIN or PNPM_BIN\n' >&2
exit 127
