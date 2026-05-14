import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  AZURACAST_BASE_URL: z.string().url(),
  AZURACAST_API_KEY: z.string().min(1),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_ENDPOINT: z.string().url().optional(),

  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  STATION_IDS: z.string().optional(),
  MEDIA_TYPES: z.string().optional(),
  LIMIT_PER_STATION: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined)),
  CONCURRENCY: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 4)),
});

export type MediaType = "media" | "ondemand" | "artwork" | "recordings";
const ALL_TYPES: MediaType[] = ["media", "ondemand", "artwork", "recordings"];

export function loadEnv() {
  const raw = schema.parse(process.env);
  const endpoint =
    raw.R2_ENDPOINT ?? `https://${raw.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const stationIds = raw.STATION_IDS
    ? raw.STATION_IDS.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const mediaTypes: MediaType[] = raw.MEDIA_TYPES
    ? (raw.MEDIA_TYPES.split(",")
        .map((s) => s.trim())
        .filter(Boolean) as MediaType[])
    : ALL_TYPES;

  return {
    azuracast: {
      baseUrl: raw.AZURACAST_BASE_URL.replace(/\/+$/, ""),
      apiKey: raw.AZURACAST_API_KEY,
    },
    r2: {
      accountId: raw.R2_ACCOUNT_ID,
      accessKeyId: raw.R2_ACCESS_KEY_ID,
      secretAccessKey: raw.R2_SECRET_ACCESS_KEY,
      endpoint,
    },
    supabase:
      raw.SUPABASE_URL && raw.SUPABASE_SERVICE_ROLE_KEY
        ? { url: raw.SUPABASE_URL, serviceRoleKey: raw.SUPABASE_SERVICE_ROLE_KEY }
        : undefined,
    dryRun: raw.DRY_RUN,
    stationIds,
    mediaTypes,
    limitPerStation: raw.LIMIT_PER_STATION,
    concurrency: raw.CONCURRENCY,
  };
}

export type AppEnv = ReturnType<typeof loadEnv>;

export function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `****${value.slice(-4)}`;
}
