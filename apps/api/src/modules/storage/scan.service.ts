import { Injectable, Logger } from '@nestjs/common';

export type ScanResult = 'clean' | 'infected' | 'skipped';

/**
 * Malware-scan hook for uploaded documents (docs/security.md — File handling).
 * The pipeline calls this before a document is processed; an `infected` result
 * quarantines the file. Phase 3 ships a no-op scanner as an explicit
 * architecture boundary — wire a real engine (ClamAV, a cloud scanner) here.
 */
export abstract class ScanService {
  abstract scan(input: { buffer: Buffer; filename: string; mime: string }): Promise<ScanResult>;
}

@Injectable()
export class NoopScanService extends ScanService {
  private readonly logger = new Logger('Scan');

  async scan(input: { filename: string }): Promise<ScanResult> {
    this.logger.debug(`No malware scanner configured; skipping scan for ${input.filename}.`);
    return 'skipped';
  }
}
