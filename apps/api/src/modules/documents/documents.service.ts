import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { loadEnv } from '@trace/config';
import { AppError, page, type Page } from '@trace/shared';
import { withOrgContext, writeAuditLog, type TenantDb } from '@trace/db';
import { documentStorageKey, type StorageService } from '@trace/storage';
import { STORAGE_SERVICE } from '../storage/storage.module';
import { ScanService } from '../storage/scan.service';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DocumentView {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  checksumSha256: string;
  version: number;
  processingStatus: string;
  scanStatus: string;
  storageDriver: string;
  uploadedByUserId: string;
  createdAt: string;
}

const DOWNLOAD_TTL_SECONDS = 300;

const MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { mime: 'image/jpeg', test: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    test: (b) => b.subarray(0, 2).toString('latin1') === 'PK',
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    test: (b) => b.subarray(0, 2).toString('latin1') === 'PK',
  },
];

@Injectable()
export class DocumentsService {
  private readonly env = loadEnv();
  private readonly allowedMime = new Set(
    this.env.DOCUMENT_ALLOWED_MIME.split(',').map((s) => s.trim()).filter(Boolean),
  );

  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly scanner: ScanService,
  ) {}

  async upload(
    organizationId: string,
    actorUserId: string,
    file: UploadedFile | undefined,
    requestId: string,
  ): Promise<DocumentView> {
    if (!file) throw AppError.validation('document.no_file', 'No file was provided.');
    if (file.size > this.env.DOCUMENT_MAX_BYTES) {
      throw AppError.validation(
        'document.too_large',
        `File exceeds the ${Math.floor(this.env.DOCUMENT_MAX_BYTES / 1_048_576)} MB limit.`,
      );
    }
    if (!this.allowedMime.has(file.mimetype)) {
      throw AppError.unprocessable(
        'document.mime_not_allowed',
        `File type "${file.mimetype}" is not accepted.`,
      );
    }
    const magic = MAGIC.find((m) => m.mime === file.mimetype);
    if (magic && !magic.test(file.buffer)) {
      throw AppError.unprocessable(
        'document.content_mismatch',
        'File content does not match its declared type.',
      );
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    return withOrgContext(organizationId, async (db) => {
      const existing = await db.document.findFirst({
        where: { organizationId, checksumSha256: checksum, filename: file.originalname },
      });
      if (existing) return this.toView(existing);

      const scan = await this.scanner.scan({
        buffer: file.buffer,
        filename: file.originalname,
        mime: file.mimetype,
      });
      if (scan === 'infected') {
        await writeAuditLog(db, {
          organizationId,
          actorId: actorUserId,
          action: 'document.rejected_infected',
          resourceType: 'document',
          resourceId: null,
          before: null,
          after: { filename: file.originalname, checksum },
          requestId,
        });
        throw AppError.unprocessable('document.infected', 'The file failed the malware scan.');
      }

      const storageKey = documentStorageKey({
        organizationId,
        checksumSha256: checksum,
        filename: file.originalname,
      });
      await this.storage.put({
        key: storageKey,
        body: file.buffer,
        contentType: file.mimetype,
        checksumSha256: checksum,
      });

      const doc = await db.document.create({
        data: {
          organizationId,
          filename: file.originalname,
          mime: file.mimetype,
          sizeBytes: file.size,
          checksumSha256: checksum,
          storageKey,
          storageDriver: this.storage.driver,
          processingStatus: 'scanned',
          scanStatus: scan,
          uploadedByUserId: actorUserId,
        },
      });

      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'document.uploaded',
        resourceType: 'document',
        resourceId: doc.id,
        before: null,
        after: { filename: doc.filename, mime: doc.mime, sizeBytes: doc.sizeBytes, checksum },
        requestId,
      });

      return this.toView(doc);
    });
  }

  async list(
    organizationId: string,
    query: { limit: number; cursor?: string },
  ): Promise<Page<DocumentView>> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.document.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((d) => this.toView(d));
      return page(items, hasMore ? items[items.length - 1]!.id : undefined);
    });
  }

  async get(organizationId: string, id: string): Promise<DocumentView & { downloadUrl: string }> {
    return withOrgContext(organizationId, async (db) => {
      const doc = await this.loadOrThrow(db, organizationId, id);
      const downloadUrl = await this.storage.signedDownloadUrl(doc.storageKey, {
        expiresInSeconds: DOWNLOAD_TTL_SECONDS,
        filename: doc.filename,
      });
      return { ...this.toView(doc), downloadUrl };
    });
  }

  async downloadUrl(
    organizationId: string,
    id: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return withOrgContext(organizationId, async (db) => {
      const doc = await this.loadOrThrow(db, organizationId, id);
      const url = await this.storage.signedDownloadUrl(doc.storageKey, {
        expiresInSeconds: DOWNLOAD_TTL_SECONDS,
        filename: doc.filename,
      });
      return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
    });
  }

  async remove(
    organizationId: string,
    id: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      const doc = await this.loadOrThrow(db, organizationId, id);
      const [evidenceCount, refCount] = await Promise.all([
        db.evidence.count({ where: { documentId: id } }),
        db.supplierEvidenceRef.count({ where: { documentId: id } }),
      ]);
      if (evidenceCount + refCount > 0) {
        throw AppError.conflict(
          'document.in_use',
          'This document is linked to evidence and cannot be deleted.',
        );
      }
      await this.storage.delete(doc.storageKey).catch(() => undefined);
      await db.document.delete({ where: { id } });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'document.deleted',
        resourceType: 'document',
        resourceId: id,
        before: { filename: doc.filename, checksum: doc.checksumSha256 },
        after: null,
        requestId,
      });
    });
  }

  private async loadOrThrow(db: TenantDb, organizationId: string, id: string) {
    const doc = await db.document.findFirst({ where: { id, organizationId } });
    if (!doc) throw AppError.notFound('document.not_found', 'Document not found.');
    return doc;
  }

  private toView(d: {
    id: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    checksumSha256: string;
    version: number;
    processingStatus: string;
    scanStatus: string;
    storageDriver: string;
    uploadedByUserId: string;
    createdAt: Date;
  }): DocumentView {
    return {
      id: d.id,
      filename: d.filename,
      mime: d.mime,
      sizeBytes: d.sizeBytes,
      checksumSha256: d.checksumSha256,
      version: d.version,
      processingStatus: d.processingStatus,
      scanStatus: d.scanStatus,
      storageDriver: d.storageDriver,
      uploadedByUserId: d.uploadedByUserId,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
