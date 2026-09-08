import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  LocalStorageConfig,
  ObjectHead,
  PutObjectInput,
  SignedUrlOptions,
  StorageService,
} from './types';

/**
 * Disk-backed storage for development. Objects live under `config.dir`; the key
 * is used as the relative path (segments only, no traversal). Downloads are
 * served by the API's `/storage/local` route, which calls `verifyLocalToken`.
 */
export class LocalStorageService implements StorageService {
  readonly driver = 'local' as const;

  constructor(private readonly config: LocalStorageConfig) {}

  private resolve(key: string): string {
    const segments = key.split('/').filter(Boolean);
    if (segments.length === 0 || segments.some((s) => s === '.' || s === '..')) {
      throw new Error('Invalid storage key');
    }
    const base = path.resolve(this.config.dir);
    const full = path.join(base, ...segments);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  async put(input: PutObjectInput): Promise<void> {
    const full = this.resolve(input.key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, input.body);
    await fs.writeFile(
      `${full}.meta.json`,
      JSON.stringify({
        contentType: input.contentType,
        checksumSha256: input.checksumSha256 ?? null,
        size: input.body.byteLength,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const full = this.resolve(key);
      const stat = await fs.stat(full);
      let contentType: string | undefined;
      try {
        const meta = JSON.parse(await fs.readFile(`${full}.meta.json`, 'utf8')) as {
          contentType?: string;
        };
        contentType = meta.contentType;
      } catch {
        contentType = undefined;
      }
      return { size: stat.size, contentType };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    await fs.rm(full, { force: true });
    await fs.rm(`${full}.meta.json`, { force: true });
  }

  async signedDownloadUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + options.expiresInSeconds;
    const payload = `${key}|${exp}|${options.filename ?? ''}`;
    const sig = this.sign(payload);
    const token = Buffer.from(`${payload}|${sig}`, 'utf8').toString('base64url');
    return `${this.config.apiPublicUrl.replace(/\/$/, '')}/api/v1/storage/local?token=${token}`;
  }

  verifyLocalToken(token: string): { key: string } | null {
    let decoded: string;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const parts = decoded.split('|');
    if (parts.length !== 4) return null;
    const [key, expRaw, filename, sig] = parts as [string, string, string, string];
    const payload = `${key}|${expRaw}|${filename}`;
    const expected = this.sign(payload);
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
    return { key };
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.config.signingSecret).update(payload).digest('hex');
  }
}
