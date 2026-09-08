import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@trace/config';

export type MagicLinkPurpose = 'login' | 'invite';

/**
 * Phase 1 email delivery. `EMAIL_TRANSPORT=console` (the dev default) logs the
 * link; `smtp` is a documented architecture boundary until Phase 1 hardening —
 * it logs a warning and the link rather than silently dropping it.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');
  private readonly env = loadEnv();

  async sendMagicLink(email: string, url: string, purpose: MagicLinkPurpose): Promise<void> {
    if (this.env.EMAIL_TRANSPORT === 'smtp') {
      this.logger.warn(
        `SMTP transport is not implemented in Phase 1. Would send a ${purpose} link to ${email}.`,
      );
    }
    // Never log tokens in production dashboards; this is the dev sign-in path.
    this.logger.log(`Magic link (${purpose}) for ${email}: ${url}`);
  }
}
