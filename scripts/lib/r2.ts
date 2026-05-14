import {
  S3Client,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
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

export async function uploadFromUrl(
  client: S3Client,
  bucket: string,
  key: string,
  sourceUrl: string,
  filename: string,
): Promise<UploadResult> {
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) {
    throw new Error(`source ${sourceUrl} → ${res.status} ${res.statusText}`);
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
