import type { AppEnv, MediaType } from "./env";

export interface AzStation {
  id: number;
  name: string;
  shortcode: string;
}

export interface AzMediaItem {
  type: MediaType;
  id: string | number;
  unique_id?: string;
  original_filename: string;
  download_url?: string;
  art_url?: string;
  mtime?: number; // unix seconds
  raw: unknown;
}

export class AzuraCastClient {
  constructor(private env: AppEnv["azuracast"]) {}

  private async req<T>(path: string): Promise<T> {
    const url = `${this.env.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: {
        "X-API-Key": this.env.apiKey,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`AzuraCast ${path} → ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  async listStations(): Promise<AzStation[]> {
    const raw = await this.req<any[]>("/api/stations");
    return raw.map((s) => ({
      id: Number(s.id),
      name: String(s.name ?? `station-${s.id}`),
      shortcode: String(s.shortcode ?? s.short_name ?? `station-${s.id}`),
    }));
  }

  async listMedia(stationId: number): Promise<AzMediaItem[]> {
    const items = await this.req<any[]>(
      `/api/station/${stationId}/files`,
    ).catch(() => [] as any[]);
    const out: AzMediaItem[] = [];
    for (const it of items) {
      const downloadUrl: string | undefined =
        it.links?.download ?? it.download_url ?? undefined;
      const filename: string =
        it.path?.split("/").pop() ??
        it.original_name ??
        `track-${it.id ?? it.unique_id}`;
      out.push({
        type: "media",
        id: it.id ?? it.unique_id ?? filename,
        unique_id: it.unique_id,
        original_filename: filename,
        download_url: downloadUrl ? this.absolutize(downloadUrl) : undefined,
        art_url: it.art ? this.absolutize(String(it.art)) : undefined,
        mtime: it.mtime ? Number(it.mtime) : undefined,
        raw: it,
      });
    }
    return out;
  }

  async listOnDemand(stationId: number): Promise<AzMediaItem[]> {
    const items = await this.req<any[]>(
      `/api/station/${stationId}/ondemand`,
    ).catch(() => [] as any[]);
    return items.map((it) => {
      const downloadUrl: string | undefined =
        it.download_url ?? it.links?.download ?? undefined;
      const filename: string =
        it.media?.path?.split("/").pop() ??
        it.media?.original_name ??
        `ondemand-${it.media?.id ?? it.id}`;
      return {
        type: "ondemand" as const,
        id: it.media?.id ?? it.id ?? filename,
        unique_id: it.media?.unique_id,
        original_filename: filename,
        download_url: downloadUrl ? this.absolutize(downloadUrl) : undefined,
        art_url: it.media?.art ? this.absolutize(String(it.media.art)) : undefined,
        mtime: it.media?.mtime ? Number(it.media.mtime) : undefined,
        raw: it,
      };
    });
  }

  /** Artwork derived from media items that expose an `art` URL. */
  artworkFromMedia(items: AzMediaItem[]): AzMediaItem[] {
    const out: AzMediaItem[] = [];
    for (const it of items) {
      if (!it.art_url) continue;
      out.push({
        type: "artwork",
        id: `${it.id}-art`,
        unique_id: it.unique_id,
        original_filename: `${String(it.id)}.jpg`,
        download_url: it.art_url,
        mtime: it.mtime,
        raw: it.raw,
      });
    }
    return out;
  }

  async listRecordings(stationId: number): Promise<AzMediaItem[]> {
    // Endpoint name varies by AzuraCast version; try a couple of candidates.
    const candidates = [
      `/api/station/${stationId}/recordings`,
      `/api/station/${stationId}/streamers/broadcasts`,
    ];
    for (const path of candidates) {
      try {
        const items = await this.req<any[]>(path);
        if (!Array.isArray(items)) continue;
        return items.map((it) => {
          const downloadUrl: string | undefined =
            it.recording?.links?.download ??
            it.links?.download ??
            it.download_url;
          const filename: string =
            it.recording?.path?.split("/").pop() ??
            it.path?.split("/").pop() ??
            `recording-${it.id}`;
          return {
            type: "recordings" as const,
            id: it.id ?? filename,
            original_filename: filename,
            download_url: downloadUrl ? this.absolutize(downloadUrl) : undefined,
            mtime: it.timestampStart ?? it.timestamp_start ?? undefined,
            raw: it,
          };
        });
      } catch {
        // try next
      }
    }
    return [];
  }

  private absolutize(u: string): string {
    if (/^https?:\/\//i.test(u)) return u;
    const sep = u.startsWith("/") ? "" : "/";
    return `${this.env.baseUrl}${sep}${u}`;
  }
}
