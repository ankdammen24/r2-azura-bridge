## Mål

Två filer som gör det enkelt att köra migration lokalt utan att behöva exportera env vars manuellt varje gång.

## Filer

### 1. `.env.example` (commit:ad mall)
Mall som användaren kopierar till `.env.local`. Innehåller alla env-nycklar med tomma/default-värden och korta kommentarer:

```
# AzuraCast
AZURACAST_BASE_URL=
AZURACAST_API_KEY=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
# R2_ENDPOINT=  # valfritt, default https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com

# Migration
DRY_RUN=true
# STATION_IDS=1
# MEDIA_TYPES=media,ondemand,artwork,recordings
# LIMIT_PER_STATION=5
# CONCURRENCY=4

# Supabase (valfritt — endast om storage_assets ska indexeras)
# SUPABASE_URL=
# SUPABASE_SERVICE_ROLE_KEY=
```

Lägg `.env.local` i `.gitignore` (om inte redan där).

### 2. `scripts/run-migration.sh` (lokal runner)
Bash-runner som:
- Laddar `.env.local` från repo-root (om filen finns) via `set -a; source .env.local; set +a`
- Felar tydligt om `.env.local` saknas, med hint att kopiera från `.env.example`
- Validerar att required-vars är satta (annars fail med lista över saknade)
- Vidarebefordrar argument till scriptet så man kan göra `./scripts/run-migration.sh --dry` eller passa flaggor
- Stöder två snabba flaggor:
  - `--dry` → tvingar `DRY_RUN=true`
  - `--real` → tvingar `DRY_RUN=false` + kort bekräftelse-prompt (`yes/N`)
- Kör `bun run migrate:azuracast`
- Exit code propageras

Filen blir körbar (`chmod +x`).

## Användning

```bash
cp .env.example .env.local
# fyll i värden
./scripts/run-migration.sh           # dry-run (default från .env.local)
./scripts/run-migration.sh --real    # skarp körning, med bekräftelse
STATION_IDS=1 LIMIT_PER_STATION=5 ./scripts/run-migration.sh --real
```

## Avgränsningar
- Ingen ändring i `migrate-azuracast-to-r2.ts` eller lib/.
- Ingen Windows `.ps1`/`.cmd`-variant (kan läggas till om du vill).
- Inga secrets i Lovable Cloud — allt körs lokalt mot din maskins env.
