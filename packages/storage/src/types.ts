/**
 * Storage abstraction (brief §32, docs/architecture.md — "Files").
 *
 * Feature code depends only on `StorageService`; the concrete driver (local disk
 * for dev, S3-compatible for deployment) is chosen by `createStorageService`.
 * Storage keys are opaque and never exposed to clients — downloads go through a
 * short-lived signed URL.
 */

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /** Stored as object metadata where the driver supports it. */
  checksumSha256?: string;
}

export interface ObjectHead {
  size: number;
  contentType?: string;
}

export interface SignedUrlOptions {
  expiresInSeconds: number;
  /** Suggested download filename (Content-Disposition). */
  filename?: string;
}

export interface StorageService {
  readonly driver: 'local' | 's3';
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
  /** A URL a browser can GET directly for a limited time. */
  signedDownloadUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /**
   * Local driver only: verify a token minted for the `/storage/local` route.
   * Returns the object key, or null if the token is invalid/expired. S3 driver
   * returns null (its signed URLs point straight at the bucket).
   */
  verifyLocalToken(token: string): { key: string } | null;
}

export interface LocalStorageConfig {
  driver: 'local';
  /** Absolute or cwd-relative directory for stored objects. */
  dir: string;
  /** HMAC secret for signed download tokens. */
  signingSecret: string;
  /** Public base URL of the API, e.g. http://localhost:4000 */
  apiPublicUrl: string;
}

export interface S3StorageConfig {
  driver: 's3';
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export type StorageConfig = LocalStorageConfig | S3StorageConfig;
