import type { MediaType } from "./env";

export const BUCKETS = {
  media: "radio-core-media",
  artwork: "radio-core-artwork",
  import: "radio-core-import",
  public: "radio-core-public",
  archives: "radio-core-archives",
  streamCache: "radio-core-stream-cache",
} as const;

export interface TargetLocation {
  bucket: string;
  prefix: string; // includes trailing slash
}

export function mapTarget(type: MediaType, stationShortName: string, date: Date): TargetLocation {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const dayPath = `${yyyy}-${mm}-${dd}`;
  const station = sanitizeSegment(stationShortName);

  switch (type) {
    case "media":
      return {
        bucket: BUCKETS.import,
        prefix: "incoming/",
      };
    case "ondemand":
      return {
        bucket: BUCKETS.media,
        prefix: `azuracast/${station}/ondemand/${dayPath}/`,
      };
    case "artwork":
      return {
        bucket: BUCKETS.artwork,
        prefix: `azuracast/${station}/artwork/${dayPath}/`,
      };
    case "recordings":
      return {
        bucket: BUCKETS.archives,
        prefix: `azuracast/${station}/recordings/${dayPath}/`,
      };
  }
}

export function safeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/]+/g, "_");
  // keep alnum, dash, dot, underscore; replace whitespace with -
  const cleaned = trimmed.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned || `file-${Date.now()}`;
}

function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "-").toLowerCase() || "station";
}
