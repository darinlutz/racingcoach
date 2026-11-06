import { S3Client } from '@aws-sdk/client-s3';

// One way to make an S3 client for any S3-compatible store (Cloudflare R2, AWS S3, Backblaze B2, MinIO), shared by
// the Broadcast Video Library's store (objectStorage.ts) and the lap telemetry store (telemetryStorage.ts), which
// have their own buckets and credentials.
export type S3Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export function createS3Client(
  config: S3Config,
  options: { maxAttempts?: number; connectionTimeoutMs?: number; requestTimeoutMs?: number } = {}
): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Otherwise presigned PUTs carry a checksum of an empty body, which stores like R2 refuse
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // The SDK's own retries: exponential backoff with jitter on throttling, 5xx and network errors, never on 4xx
    ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.connectionTimeoutMs || options.requestTimeoutMs
      ? { requestHandler: { connectionTimeout: options.connectionTimeoutMs, requestTimeout: options.requestTimeoutMs } }
      : {}),
  });
}
