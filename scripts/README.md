# AzuraCast → Cloudflare R2 migration

Standalone, temporary CLI. Runs locally / in CI. Not part of the Radio Core runtime.

## Buckets used

| Source                      | Bucket                  | Prefix                                       |
| --------------------------- | ----------------------- | -------------------------------------------- |
| station media library       | `radio-core-media`      | `azuracast/{station}/media/{yyyy-mm-dd}/`    |
| on-demand                   | `radio-core-media`      | `azuracast/{station}/ondemand/{yyyy-mm-dd}/` |
| artwork (cover from media)  | `radio-core-artwork`    | `azuracast/{station}/artwork/{yyyy-mm-dd}/`  |
| recordings / archive        | `radio-core-archives`   | `azuracast/{station}/recordings/{yyyy-mm-dd}/` |

`radio-core-import`, `radio-core-public`, `radio-core-stream-cache` are not written by this script (no natural AzuraCast source).

## Env

Required:
- `AZURACAST_BASE_URL`   — e.g. `https://azuracast.example.com`
- `AZURACAST_API_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Optional:
- `R2_ENDPOINT`              — defaults to `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
- `DRY_RUN`                  — `true` (default) | `false`
- `SUPABASE_URL`             — enable indexing into `storage_assets` if table exists
- `SUPABASE_SERVICE_ROLE_KEY`
- `STATION_IDS`              — comma-separated AzuraCast station IDs to limit scope
- `MEDIA_TYPES`              — subset of `media,ondemand,artwork,recordings`
- `LIMIT_PER_STATION`        — cap items per type per station (smoke testing)
- `CONCURRENCY`              — default `4`

Place these in a local `.env` (gitignored) or pass via shell.

## Run

```bash
# Dry run (default) — no R2 writes, full report
bun run migrate:azuracast

# Real migration
DRY_RUN=false bun run migrate:azuracast

# Filtered smoke
STATION_IDS=1 MEDIA_TYPES=media LIMIT_PER_STATION=5 DRY_RUN=false bun run migrate:azuracast
```

## Output

- `migration-report.json`
- `migration-report.csv`

Per-row status: `planned | copied | skipped | failed`. Existing R2 objects are never overwritten.

## Supabase indexing

Optional. The script probes `storage_assets`. If it doesn't exist, indexing is silently disabled (no schema is created).

Insert shape:
```json
{
  "bucket": "...",
  "key": "...",
  "original_filename": "...",
  "file_type": "audio/mpeg",
  "source": "azuracast_migration",
  "status": "available",
  "metadata": { "station": "...", "azuracast_id": "...", "migrated_at": "..." }
}
```

## Security

- CLI only — no browser bundle imports.
- API keys / R2 credentials never logged in clear (masked to `****1234`).
- No public R2 URLs are generated.
