import type { AppEnv } from "./env";

export interface IndexRecord {
  bucket: string;
  key: string;
  original_filename: string;
  file_type: string;
  station: string;
  azuracast_id: string;
}

export class SupabaseIndexer {
  private available = false;
  private checked = false;

  constructor(private cfg: NonNullable<AppEnv["supabase"]>) {}

  private headers() {
    return {
      apikey: this.cfg.serviceRoleKey,
      Authorization: `Bearer ${this.cfg.serviceRoleKey}`,
      "Content-Type": "application/json",
    };
  }

  async ensure(): Promise<boolean> {
    if (this.checked) return this.available;
    this.checked = true;
    try {
      const res = await fetch(
        `${this.cfg.url}/rest/v1/storage_assets?select=id&limit=1`,
        { headers: this.headers() },
      );
      this.available = res.ok;
      if (!res.ok) {
        console.warn(
          `[supabase] storage_assets probe → ${res.status}; indexing disabled`,
        );
      }
    } catch (err) {
      console.warn("[supabase] probe failed:", (err as Error).message);
      this.available = false;
    }
    return this.available;
  }

  async insert(rec: IndexRecord): Promise<void> {
    if (!this.available) return;
    const body = {
      bucket: rec.bucket,
      key: rec.key,
      original_filename: rec.original_filename,
      file_type: rec.file_type,
      source: "azuracast_migration",
      status: "available",
      metadata: {
        station: rec.station,
        azuracast_id: rec.azuracast_id,
        migrated_at: new Date().toISOString(),
      },
    };
    const res = await fetch(`${this.cfg.url}/rest/v1/storage_assets`, {
      method: "POST",
      headers: { ...this.headers(), Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(
        `[supabase] insert failed (${res.status}) for ${rec.bucket}/${rec.key}`,
      );
    }
  }
}
