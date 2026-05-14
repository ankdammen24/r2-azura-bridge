## Mål

Ett separat, temporärt CLI-script som kopierar media från AzuraCast till rätt Cloudflare R2-bucket, producerar JSON+CSV-rapport och (om Supabase + tabellen `storage_assets` finns) indexerar uppladdade objekt. Ingen runtime-integration i Radio Core.

## Leveranser

```
scripts/
  migrate-azuracast-to-r2.ts        # huvud-CLI
  lib/
    azuracast.ts                    # API-klient (stations, media, ondemand, recordings)
    r2.ts                           # S3-klient mot R2 + key-builder + exists-check
    report.ts                       # JSON+CSV writer
    supabase-index.ts               # valfri storage_assets-insert
    mapping.ts                      # media_type → bucket/prefix-mappning
    env.ts                          # zod-validerad env-loader
  README.md                         # körinstruktioner
```

Inget i `src/` ändras. Inga UI-routes. Inga edge functions.

## Steg

### A. Analys (innan kod)
- Bekräfta att `scripts/` inte finns och att inga tidigare migration-script kolliderar.
- Kontrollera om Lovable Cloud (Supabase) är aktiverat och om tabellen `storage_assets` existerar. Annars hoppas Supabase-indexering över med en informativ logg — migreringen blockeras inte.

### B. Dependencies (dev-only)
Installera: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `zod`, `tsx`, `dotenv`, `mime-types`, `p-limit`, `csv-stringify`.
Lägg till npm-script:
```json
"migrate:azuracast": "tsx scripts/migrate-azuracast-to-r2.ts"
```

### C. Konfiguration (`scripts/lib/env.ts`)
Läser från `process.env` via zod:
- `AZURACAST_BASE_URL`, `AZURACAST_API_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` (default `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
- `DRY_RUN` (default `true`)
- Valfri Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Valfria filter: `STATION_IDS`, `MEDIA_TYPES` (`media,ondemand,artwork,recordings`), `LIMIT_PER_STATION`, `CONCURRENCY` (default 4)

### D. AzuraCast-discovery (`lib/azuracast.ts`)
Auth-header: `X-API-Key`. Endpoints som används:
- `GET /api/stations` → lista stationer
- `GET /api/station/{id}/files` → media library (paginerat)
- `GET /api/station/{id}/ondemand` → on-demand
- `GET /api/station/{id}/recordings` (om finns) → arkiv
Per item plockas: `id`, `unique_id`, `path`, `length`, `art` (om finns), `download_url`/`links.download`, `original_name`, ev. `mtime`. Saknas nedladdningsbar källa loggas `no downloadable source found` och raden får status `skipped`.

### E. Mappning (`lib/mapping.ts`)
| Källa | Bucket | Prefix |
|---|---|---|
| station media library | `radio-core-media` | `azuracast/{station}/media/{yyyy-mm-dd}/` |
| on-demand | `radio-core-media` | `azuracast/{station}/ondemand/{yyyy-mm-dd}/` |
| artwork/cover | `radio-core-artwork` | `azuracast/{station}/artwork/{yyyy-mm-dd}/` |
| recordings/archive | `radio-core-archives` | `azuracast/{station}/recordings/{yyyy-mm-dd}/` |
| import/dropzone | `radio-core-import` | `azuracast/{station}/import/{yyyy-mm-dd}/` |
| publika assets | `radio-core-public` | `azuracast/{station}/public/{yyyy-mm-dd}/` |

`safe_filename` = slugifierad basename + originalfilens ext. Datum från `mtime` annars dagens.

### F. R2-upload (`lib/r2.ts`)
S3Client med `region: "auto"`, `forcePathStyle: true`, endpoint enligt env. Per objekt:
1. `HeadObject` på target-key → om finns: status `skipped` (no overwrite).
2. Stream `download_url` med `fetch` → `Upload` (`@aws-sdk/lib-storage`) med `ContentType` från response-header eller `mime-types`.
3. Returnera storlek från Content-Length eller uppmätt under stream.
Concurrency styrs av `p-limit`.

`DRY_RUN=true`: ingen `HEAD`, ingen upload — bara plan-rad i rapporten med status `planned`.

### G. Rapport (`lib/report.ts`)
Skriver `migration-report.json` och `migration-report.csv` till repo-roten med fälten:
`source_station, source_id, source_url, original_filename, target_bucket, target_key, content_type, size_bytes, status, error_message`.
Statusar: `planned | copied | skipped | failed`. Aggregerad summary loggas i slutet.

### H. Supabase-indexering (`lib/supabase-index.ts`)
Om `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` finns OCH tabellen `storage_assets` existerar (probe-select), insert efter lyckad upload:
```
{ bucket, key, original_filename, file_type, source: "azuracast_migration",
  status: "available",
  metadata: { station, azuracast_id, migrated_at } }
```
Saknas tabellen → logga och hoppa över (ingen migration skapas av detta script).

### I. CLI-flöde (`migrate-azuracast-to-r2.ts`)
1. Ladda + validera env.
2. Skriv ut effektiv konfig (maskerade nycklar) + `DRY_RUN`-status.
3. Hämta stationer (med ev. filter).
4. För varje station + valda media-typer: lista → mappa → planera → ev. upload → indexera → rapportera.
5. Tydliga loggar per item: `[station/type] original → bucket/key  status`.
6. Skriv rapport, exit-kod 0 om inga `failed`, annars 1.

### J. Säkerhet
- Allt är CLI; inga browser-imports.
- Inga env-värden loggas; nycklar maskeras till `****1234`.
- Inga publika R2-URL:er skapas eller skrivs ut.
- Service role-nyckel används endast i scriptet, aldrig i klientkod.

### K. Verifiering
- `bun run lint` och `tsc --noEmit` (via TanStack-build körs automatiskt — scriptet ligger utanför `src/` så det påverkar inte SSR-bundlen).
- Smoke: `DRY_RUN=true bun run migrate:azuracast` mot riktig AzuraCast → ingen R2-skrivning, fullständig rapport.

## Körkommandon

```bash
# Dry-run (default)
DRY_RUN=true bun run migrate:azuracast

# Skarp körning
DRY_RUN=false bun run migrate:azuracast

# Filtrerat
STATION_IDS=1,2 MEDIA_TYPES=media,artwork DRY_RUN=false bun run migrate:azuracast
```

## Env / secrets som behövs
Required: `AZURACAST_BASE_URL`, `AZURACAST_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
Optional: `R2_ENDPOINT`, `DRY_RUN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STATION_IDS`, `MEDIA_TYPES`, `LIMIT_PER_STATION`, `CONCURRENCY`.
Eftersom scriptet körs lokalt/CI läses dessa från en lokal `.env` (ej committad) eller shell-env — inte från Lovable Cloud secrets-store (den är till för runtime-server, inte CLI).

## Ej i scope
Radio Core R2-runtime, DSP-distribution, EBU R128, waveform, permanent UI.

## Öppna frågor (svara gärna före implementation)
1. Ska `radio-core-stream-cache` användas av migrationen? Den listades i bucket-listan men det finns ingen naturlig AzuraCast-källa — förslag: lämna tom, generera vid runtime senare.
2. Finns `storage_assets`-tabellen redan i din Supabase, eller ska jag bara probea och hoppa över om den saknas? (Jag skapar den inte automatiskt.)
3. Vill du ha CSV+JSON i repo-roten eller under `scripts/out/`?
