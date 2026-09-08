import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorageService } from './local';

describe('LocalStorageService', () => {
  let dir: string;
  let store: LocalStorageService;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-storage-'));
    store = new LocalStorageService({
      driver: 'local',
      dir,
      signingSecret: 'test-signing-secret-value',
      apiPublicUrl: 'http://localhost:4000',
    });
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips put / get / head', async () => {
    const body = Buffer.from('hello evidence');
    await store.put({ key: 'docs/org/abc/report.pdf', body, contentType: 'application/pdf' });
    expect((await store.get('docs/org/abc/report.pdf')).toString()).toBe('hello evidence');
    const head = await store.head('docs/org/abc/report.pdf');
    expect(head).toEqual({ size: body.byteLength, contentType: 'application/pdf' });
  });

  it('rejects path traversal in keys', async () => {
    await expect(
      store.put({ key: '../../etc/passwd', body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toThrow(/Invalid storage key/);
  });

  it('mints a signed URL that verifies back to the key', async () => {
    const url = await store.signedDownloadUrl('docs/org/abc/report.pdf', {
      expiresInSeconds: 60,
      filename: 'report.pdf',
    });
    const token = new URL(url).searchParams.get('token')!;
    expect(store.verifyLocalToken(token)).toEqual({ key: 'docs/org/abc/report.pdf' });
  });

  it('rejects a tampered token', () => {
    expect(store.verifyLocalToken('not-a-real-token')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const url = await store.signedDownloadUrl('docs/org/abc/report.pdf', { expiresInSeconds: -10 });
    const token = new URL(url).searchParams.get('token')!;
    expect(store.verifyLocalToken(token)).toBeNull();
  });

  it('head returns null for a missing object', async () => {
    expect(await store.head('docs/org/missing/x.pdf')).toBeNull();
  });
});
