import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@trace/config';
import { createStorageService, type StorageService } from '@trace/storage';
import { StorageController } from './storage.controller';
import { ScanService, NoopScanService } from './scan.service';
import { STORAGE_SERVICE } from './storage.tokens';

export { STORAGE_SERVICE };

@Global()
@Module({
  controllers: [StorageController],
  providers: [
    {
      provide: STORAGE_SERVICE,
      useFactory: (): StorageService => {
        const env = loadEnv();
        if (env.STORAGE_DRIVER === 's3') {
          return createStorageService({
            driver: 's3',
            bucket: env.STORAGE_BUCKET,
            region: env.STORAGE_REGION,
            endpoint: env.STORAGE_ENDPOINT || undefined,
            accessKeyId: env.STORAGE_ACCESS_KEY_ID,
            secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
            forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
          });
        }
        return createStorageService({
          driver: 'local',
          dir: env.STORAGE_LOCAL_DIR,
          signingSecret: env.STORAGE_SIGNING_SECRET,
          apiPublicUrl: env.API_PUBLIC_URL,
        });
      },
    },
    { provide: ScanService, useClass: NoopScanService },
  ],
  exports: [STORAGE_SERVICE, ScanService],
})
export class StorageModule {}
