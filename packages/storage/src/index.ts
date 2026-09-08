import { LocalStorageService } from './local';
import { S3StorageService } from './s3';
import type { StorageConfig, StorageService } from './types';

export * from './types';
export { LocalStorageService } from './local';
export { S3StorageService } from './s3';

export function createStorageService(config: StorageConfig): StorageService {
  return config.driver === 's3'
    ? new S3StorageService(config)
    : new LocalStorageService(config);
}

/** Build a content-addressed storage key: docs/<org>/<sha256>/<filename>. */
export function documentStorageKey(input: {
  organizationId: string;
  checksumSha256: string;
  filename: string;
}): string {
  const safeName = input.filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';
  return `docs/${input.organizationId}/${input.checksumSha256}/${safeName}`;
}
