#!/usr/bin/env bash
# Lokal runner för AzuraCast → R2 migration.
# Användning:
#   ./scripts/run-migration.sh          # dry-run (default från .env.local)
#   ./scripts/run-migration.sh --dry    # tvinga DRY_RUN=true
#   ./scripts/run-migration.sh --real   # tvinga DRY_RUN=false (med bekräftelse)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✖ Saknar .env.local i repo-root."
  echo "  Skapa den med:  cp .env.example .env.local  och fyll i värden."
  exit 1
fi

# Ladda .env.local
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Hantera flaggor
FORCE_REAL=0
for arg in "$@"; do
  case "$arg" in
    --dry)  export DRY_RUN=true ;;
    --real) export DRY_RUN=false; FORCE_REAL=1 ;;
  esac
done

# Validera required env
REQUIRED=(AZURACAST_BASE_URL AZURACAST_API_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY)
MISSING=()
for v in "${REQUIRED[@]}"; do
  if [[ -z "${!v:-}" ]]; then MISSING+=("$v"); fi
done
if (( ${#MISSING[@]} > 0 )); then
  echo "✖ Saknade env vars i .env.local:"
  for v in "${MISSING[@]}"; do echo "    - $v"; done
  exit 1
fi

DRY_RUN="${DRY_RUN:-true}"
echo "→ DRY_RUN=$DRY_RUN"
echo "→ AZURACAST_BASE_URL=$AZURACAST_BASE_URL"
echo "→ STATION_IDS=${STATION_IDS:-(alla)}"
echo "→ MEDIA_TYPES=${MEDIA_TYPES:-media,ondemand,artwork,recordings}"
echo "→ LIMIT_PER_STATION=${LIMIT_PER_STATION:-(ingen gräns)}"
echo "→ CONCURRENCY=${CONCURRENCY:-4}"

if [[ "$DRY_RUN" == "false" ]]; then
  if (( FORCE_REAL == 1 )); then
    read -r -p "⚠  Skarp körning mot R2. Skriv 'yes' för att fortsätta: " confirm
    if [[ "$confirm" != "yes" ]]; then
      echo "Avbruten."
      exit 1
    fi
  fi
fi

cd "$REPO_ROOT"
exec bun run migrate:azuracast
