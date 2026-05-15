import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import mime from "mime-types";
import type { AppEnv } from "./env";

export function createR2Client(env: AppEnv["r2"]): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: env.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  });
}

export async function objectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || status === 403) return false;
    if (err?.name === "NotFound") return false;
    throw err;
  }
}

export interface UploadResult {
  size: number;
  contentType: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfter: string | null): number | undefined {
  if (!retryAfter) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const ts = Date.parse(retryAfter);
  if (Number.isFinite(ts)) return Math.max(0, ts - Date.now());
  return undefined;
}

async function fetchWithRetry(sourceUrl: string): Promise<Response> {
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(sourceUrl);
    if (res.ok) return res;

    const retryableStatus = res.status === 429 || (res.status >= 500 && res.status <= 599);
    if (!retryableStatus || attempt === maxAttempts) {
      throw new Error(`source ${sourceUrl} → ${res.status} ${res.statusText}`);
    }

    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const expBackoffMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
    const jitterMs = Math.floor(Math.random() * 250);
    await sleep((retryAfterMs ?? expBackoffMs) + jitterMs);
  }

  throw new Error(`source ${sourceUrl} → exhausted retries`);
}

export async function uploadFromUrl(
  client: S3Client,
  bucket: string,
  key: string,
  sourceUrl: string,
  filename: string,
): Promise<UploadResult> {
  const res = await fetchWithRetry(sourceUrl);
  if (!res.body) {
    throw new Error(`source ${sourceUrl} → empty response body`);
  }
  const headerType = res.headers.get("content-type") ?? undefined;
  const guessed = mime.lookup(filename) || undefined;
  const contentType = headerType || guessed || "application/octet-stream";
  const contentLength = Number(res.headers.get("content-length") ?? 0);

  // Convert WebStream → Node Readable for AWS SDK
  const { Readable } = await import("node:stream");
  const nodeStream = Readable.fromWeb(res.body as any);

  const uploader = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: nodeStream,
      ContentType: contentType,
    },
  });
  await uploader.done();

  return { size: contentLength, contentType };
}
