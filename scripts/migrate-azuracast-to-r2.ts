#!/usr/bin/env tsx
/**
 * AzuraCast → Cloudflare R2 migration CLI.
 *
 * Run:
 *   DRY_RUN=true bun run migrate:azuracast
 *   DRY_RUN=false bun run migrate:azuracast
 */
import pLimit from "p-limit";
import { loadEnv, mask, type MediaType } from "./lib/env";
import { AzuraCastClient, type AzMediaItem } from "./lib/azuracast";
import { mapTarget, safeFilename } from "./lib/mapping";
import { createR2Client, objectExists, uploadFromUrl } from "./lib/r2";
import { Report, type ReportRow } from "./lib/report";
import { SupabaseIndexer } from "./lib/supabase-index";

const MAX_VERBOSE_429_LOGS = 40;
const NON_MUSIC_PATTERNS = [
  /\bfx\b/i,
  /\bsfx\b/i,
  /\bjingle(s)?\b/i,
  /\btoh\b/i,
  /\bvoice[_ -]?track(s)?\b/i,
  /\bsweeper(s)?\b/i,
  /\bliner(s)?\b/i,
];

async function main() {
  const env = loadEnv();

  console.log("=== AzuraCast → R2 migration ===");
  console.log("AzuraCast base    :", env.azuracast.baseUrl);
  console.log("AzuraCast key     :", mask(env.azuracast.apiKey));
  console.log("R2 endpoint       :", env.r2.endpoint);
  console.log("R2 access key id  :", mask(env.r2.accessKeyId));
  console.log("Dry run           :", env.dryRun);
  console.log("Media types       :", env.mediaTypes.join(","));
  console.log("Stations filter   :", env.stationIds?.join(",") ?? "(all)");
  console.log("Concurrency       :", env.concurrency);
  console.log("Supabase indexing :", env.supabase ? "enabled" : "disabled");

  const az = new AzuraCastClient(env.azuracast);
  const r2 = createR2Client(env.r2);
  const report = new Report();
  const indexer = env.supabase ? new SupabaseIndexer(env.supabase) : undefined;
  if (indexer) await indexer.ensure();

  const limit = pLimit(env.concurrency);

  let stations = [] as Awaited<ReturnType<typeof az.listStations>>;
  try {
    stations = await az.listStations();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (env.dryRun) {
      console.warn(`\n[WARN] Could not reach AzuraCast in dry-run mode: ${msg}`);
      await report.write("migration-report.json", "migration-report.csv");
      console.log("Wrote empty migration report because source was unreachable in dry-run mode.");
      return;
    }
    throw err;
  }

  const filtered = env.stationIds
    ? stations.filter((s) => env.stationIds!.includes(String(s.id)))
    : stations;

  console.log(`\nFound ${stations.length} stations, processing ${filtered.length}.`);

  for (const station of filtered) {
    console.log(`\n[station ${station.shortcode}] (${station.id}) ${station.name}`);
    const collected: AzMediaItem[] = [];
    const stationStats = {
      missingSourceUrl: 0,
      nonMusicSkipped: 0,
      rateLimited429: 0,
      otherFailures: 0,
    };

    if (env.mediaTypes.includes("media")) {
      const m = await az.listMedia(station.id);
      console.log(`  media     : ${m.length}`);
      collected.push(...applyLimit(m, env.limitPerStation));

      if (env.mediaTypes.includes("artwork")) {
        const art = az.artworkFromMedia(m);
        console.log(`  artwork   : ${art.length}`);
        collected.push(...applyLimit(art, env.limitPerStation));
      }
    } else if (env.mediaTypes.includes("artwork")) {
      // need media listing to derive artwork
      const m = await az.listMedia(station.id);
      const art = az.artworkFromMedia(m);
      console.log(`  artwork   : ${art.length}`);
      collected.push(...applyLimit(art, env.limitPerStation));
    }

    if (env.mediaTypes.includes("ondemand")) {
      const od = await az.listOnDemand(station.id);
      console.log(`  ondemand  : ${od.length}`);
      collected.push(...applyLimit(od, env.limitPerStation));
    }
    if (env.mediaTypes.includes("recordings")) {
      const rec = await az.listRecordings(station.id);
      console.log(`  recordings: ${rec.length}`);
      collected.push(...applyLimit(rec, env.limitPerStation));
    }

    await Promise.all(
      collected.map((item) =>
        limit(() =>
          processItem(item, station.shortcode, env.dryRun, r2, indexer, report, stationStats),
        ),
      ),
    );

    console.log(
      `  station summary: missing_source_url=${stationStats.missingSourceUrl}, non_music_skipped=${stationStats.nonMusicSkipped}, rate_limited_429=${stationStats.rateLimited429}, other_failures=${stationStats.otherFailures}`,
    );
  }

  await report.write("migration-report.json", "migration-report.csv");
  const sum = report.summary();
  console.log("\n=== Summary ===");
  console.log(sum);
  console.log("Wrote migration-report.json and migration-report.csv");

  if (sum.failed > 0) process.exit(1);
}

function applyLimit<T>(arr: T[], limit?: number): T[] {
  return limit && limit > 0 ? arr.slice(0, limit) : arr;
}

async function processItem(
  item: AzMediaItem,
  stationShort: string,
  dryRun: boolean,
  r2: ReturnType<typeof createR2Client>,
  indexer: SupabaseIndexer | undefined,
  report: Report,
  stationStats: {
    missingSourceUrl: number;
    nonMusicSkipped: number;
    rateLimited429: number;
    otherFailures: number;
  },
) {
  const date = item.mtime ? new Date(item.mtime * 1000) : new Date();
  const target = mapTarget(item.type, stationShort, date);
  const filename = safeFilename(item.original_filename);
  const key = `${target.prefix}${filename}`;

  const baseRow: ReportRow = {
    source_station: stationShort,
    source_id: String(item.id),
    source_url: item.download_url ?? "",
    original_filename: item.original_filename,
    target_bucket: target.bucket,
    target_key: key,
    content_type: "",
    size_bytes: 0,
    status: "planned",
    error_message: "",
  };

  if (!item.download_url) {
    stationStats.missingSourceUrl++;
    report.add({
      ...baseRow,
      status: "skipped",
      error_message: "skipped: no downloadable source found",
    });
    return;
  }

  if (item.type === "media" && !isMusicCandidate(item)) {
    stationStats.nonMusicSkipped++;
    report.add({
      ...baseRow,
      status: "skipped",
      error_message: "skipped: non-music media",
    });
    return;
  }

  if (dryRun) {
    console.log(
      `  [DRY] [${stationShort}/${item.type}] ${item.original_filename} → ${target.bucket}/${key}`,
    );
    report.add(baseRow);
    return;
  }

  try {
    if (await objectExists(r2, target.bucket, key)) {
      console.log(
        `  [SKIP] [${stationShort}/${item.type}] ${item.original_filename} → exists at ${target.bucket}/${key}`,
      );
      report.add({ ...baseRow, status: "skipped", error_message: "exists" });
      return;
    }
    const result = await uploadFromUrl(r2, target.bucket, key, item.download_url, filename);
    console.log(
      `  [OK]  [${stationShort}/${item.type}] ${item.original_filename} → ${target.bucket}/${key} (${result.size} bytes)`,
    );
    const row: ReportRow = {
      ...baseRow,
      status: "copied",
      content_type: result.contentType,
      size_bytes: result.size,
    };
    report.add(row);
    if (indexer) {
      await indexer.insert({
        bucket: target.bucket,
        key,
        original_filename: item.original_filename,
        file_type: result.contentType,
        station: stationShort,
        azuracast_id: String(item.id),
      });
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes(" 429 ") || msg.includes("Too Many Requests")) {
      stationStats.rateLimited429++;
      if (stationStats.rateLimited429 <= MAX_VERBOSE_429_LOGS) {
        console.error(`  [FAIL][${stationShort}/${item.type}] ${item.original_filename} → ${msg}`);
      } else if (stationStats.rateLimited429 === MAX_VERBOSE_429_LOGS + 1) {
        console.error(`  [${stationShort}] further 429 logs suppressed...`);
      }
    } else {
      stationStats.otherFailures++;
      console.error(`  [FAIL][${stationShort}/${item.type}] ${item.original_filename} → ${msg}`);
    }
    report.add({ ...baseRow, status: "failed", error_message: msg });
  }
}

function isMusicCandidate(item: AzMediaItem): boolean {
  const filename = item.original_filename.toLowerCase();
  const rawPath =
    item.raw && typeof item.raw === "object" && "path" in item.raw
      ? String((item.raw as { path?: unknown }).path ?? "")
      : "";
  const path = rawPath.toLowerCase();
  const text = `${path} ${filename}`;

  for (const pattern of NON_MUSIC_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
