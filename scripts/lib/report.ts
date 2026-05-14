import { writeFile } from "node:fs/promises";
import { stringify } from "csv-stringify/sync";

export type Status = "planned" | "copied" | "skipped" | "failed";

export interface ReportRow {
  source_station: string;
  source_id: string;
  source_url: string;
  original_filename: string;
  target_bucket: string;
  target_key: string;
  content_type: string;
  size_bytes: number;
  status: Status;
  error_message: string;
}

export class Report {
  rows: ReportRow[] = [];

  add(row: ReportRow) {
    this.rows.push(row);
  }

  summary() {
    const byStatus: Record<Status, number> = {
      planned: 0,
      copied: 0,
      skipped: 0,
      failed: 0,
    };
    for (const r of this.rows) byStatus[r.status]++;
    return byStatus;
  }

  async write(jsonPath: string, csvPath: string) {
    await writeFile(jsonPath, JSON.stringify(this.rows, null, 2), "utf8");
    const csv = stringify(this.rows, {
      header: true,
      columns: [
        "source_station",
        "source_id",
        "source_url",
        "original_filename",
        "target_bucket",
        "target_key",
        "content_type",
        "size_bytes",
        "status",
        "error_message",
      ],
    });
    await writeFile(csvPath, csv, "utf8");
  }
}
