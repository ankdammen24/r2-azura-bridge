# AzuraCast → Cloudflare R2 migration

Standalone, temporary CLI. Runs locally / i CI. Inte del av Radio Core-runtime.

## Buckets used

| Source                      | Bucket                  | Prefix                                       |
| --------------------------- | ----------------------- | -------------------------------------------- |
| station media library       | `radio-core-media`      | `azuracast/{station}/media/{yyyy-mm-dd}/`    |
| on-demand                   | `radio-core-media`      | `azuracast/{station}/ondemand/{yyyy-mm-dd}/` |
| artwork (cover from media)  | `radio-core-artwork`    | `azuracast/{station}/artwork/{yyyy-mm-dd}/`  |
| recordings / archive        | `radio-core-archives`   | `azuracast/{station}/recordings/{yyyy-mm-dd}/` |

`radio-core-import`, `radio-core-public`, `radio-core-stream-cache` skrivs inte (ingen naturlig AzuraCast-källa).

## Env

Required: `AZURACAST_BASE_URL`, `AZURACAST_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

Optional: `R2_ENDPOINT`, `DRY_RUN` (default `true`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STATION_IDS`, `MEDIA_TYPES`, `LIMIT_PER_STATION`, `CONCURRENCY` (default `4`).

## Körsätt

### A) Lokalt

```bash
cp .env.example .env.local      # fyll i värden
./scripts/run-migration.sh           # dry-run
./scripts/run-migration.sh --real    # skarp körning (med bekräftelse)
```

### B) GitHub Action (rekommenderat för skarp körning)

Workflow: `.github/workflows/migrate-azuracast.yml` (`workflow_dispatch`).

**Engångssetup** — lägg till repo-secrets under *Settings → Secrets and variables → Actions*:

Required:
- `AZURACAST_BASE_URL`
- `AZURACAST_API_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Optional:
- `R2_ENDPOINT`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (om indexering aktiveras)

**Köra:** GitHub → *Actions* → *Migrate AzuraCast → R2* → *Run workflow*. Inputs:

| Input | Default | Beskrivning |
| ----- | ------- | ----------- |
| `dry_run` | `true` | Sätt `false` för skarp körning |
| `station_ids` | `""` | Komma-separerade IDs, tomt = alla |
| `media_types` | `media,ondemand,artwork,recordings` | Subset |
| `limit_per_station` | `""` | Cap per typ per station |
| `concurrency` | `4` | Parallella uppladdningar |
| `enable_supabase_index` | `false` | Indexera till `storage_assets` |

Rapporten (`migration-report.json` + `.csv`) laddas upp som workflow-artifact (30 dagars retention).

## Output

Per-row status: `planned | copied | skipped | failed`. Befintliga R2-objekt skrivs aldrig över.

## Supabase indexing

Valfritt. Scriptet probar `storage_assets`. Saknas tabellen avaktiveras indexering tyst (inget schema skapas).

## Säkerhet

- CLI-only, inga browser-imports.
- Credentials maskas i loggar (`****1234`).
- Inga publika R2-URLs genereras.
