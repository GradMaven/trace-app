import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ensurePermissionCatalog, ensurePlatformRole, withPlatformContext } from '@trace/db';

/**
 * Keeps the global permission catalog and the platform role in sync with
 * @trace/shared on every boot. Idempotent. A database that is unreachable at
 * startup logs an error but does not crash the process (dev without a DB).
 */
@Injectable()
export class CatalogBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  async onApplicationBootstrap(): Promise<void> {
    try {
      await withPlatformContext(async (db) => {
        await ensurePermissionCatalog(db);
        await ensurePlatformRole(db);
      });
      this.logger.log('Permission catalog and platform role are in sync.');
    } catch (err) {
      this.logger.error(
        'Could not sync the permission catalog (is the database reachable?).',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
