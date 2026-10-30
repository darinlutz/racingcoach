import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Where the Broadcast Video Library's files live: any S3-compatible object store (Cloudflare R2 recommended, as serving
// video from it costs no egress; AWS S3, Backblaze B2 and MinIO work too), never Postgres or Render's filesystem.
// Browsers upload to it and play from it with short-lived presigned URLs, so video doesn't pass through the web server.
// Configured by BROADCAST_VIDEO_S3_ENDPOINT, _BUCKET, _ACCESS_KEY_ID, _SECRET_ACCESS_KEY and optionally _REGION
// (default auto, as R2 wants). Setup, including the bucket's CORS rule, is in docs/broadcast-director.md.

const UPLOAD_URL_SECONDS = 60 * 60;
const PLAY_URL_SECONDS = 5 * 60;

function storageConfig() {
  const endpoint = process.env.BROADCAST_VIDEO_S3_ENDPOINT?.trim();
  const bucket = process.env.BROADCAST_VIDEO_S3_BUCKET?.trim();
  const accessKeyId = process.env.BROADCAST_VIDEO_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.BROADCAST_VIDEO_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.BROADCAST_VIDEO_S3_REGION?.trim() || 'auto' };
}

export const videoStorageConfigured = () => storageConfig() !== null;

let cached: { client: S3Client; bucket: string } | null = null;

function storage(): { client: S3Client; bucket: string } {
  if (cached) return cached;
  const config = storageConfig();
  if (!config) throw new Error('Object storage for broadcast videos is not configured');
  cached = {
    bucket: config.bucket,
    client: new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Otherwise presigned PUTs carry a checksum of an empty body, which stores like R2 refuse
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  };
  return cached;
}

export async function presignVideoUpload(key: string, contentType: string): Promise<string> {
  const { client, bucket } = storage();
  return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: UPLOAD_URL_SECONDS });
}

export async function presignVideoPlayback(key: string): Promise<string> {
  const { client, bucket } = storage();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: PLAY_URL_SECONDS });
}

// The object's size, or null when it isn't there
export async function videoObjectSize(key: string): Promise<number | null> {
  const { client, bucket } = storage();
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? 0;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

export async function deleteVideoObject(key: string): Promise<void> {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function downloadVideoObject(key: string, path: string): Promise<void> {
  const { client, bucket } = storage();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(response.Body as Readable, createWriteStream(path));
}

export async function uploadVideoObject(key: string, path: string, contentType: string): Promise<void> {
  const { client, bucket } = storage();
  const { size } = await stat(path);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(path), ContentType: contentType, ContentLength: size }));
}
