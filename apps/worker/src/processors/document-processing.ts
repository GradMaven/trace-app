import type { Job } from 'bullmq';
import { createAIProvider, type AIProvider } from '@trace/ai';
import { loadEnv } from '@trace/config';
import { runExtractionPipeline, withOrgContext } from '@trace/db';
import { createStorageService, type StorageService } from '@trace/storage';
import type { DocumentProcessingJob } from '../queues';

let provider: AIProvider | undefined;
let storage: StorageService | undefined;

function deps(): { provider: AIProvider; storage: StorageService } {
  const env = loadEnv();
  provider ??= createAIProvider({
    mode: env.AI_PROVIDER,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    extractionModel: env.AI_MODEL_EXTRACTION,
    classificationModel: env.AI_MODEL_CLASSIFICATION,
  });
  storage ??=
    env.STORAGE_DRIVER === 's3'
      ? createStorageService({
          driver: 's3',
          bucket: env.STORAGE_BUCKET,
          region: env.STORAGE_REGION,
          endpoint: env.STORAGE_ENDPOINT || undefined,
          accessKeyId: env.STORAGE_ACCESS_KEY_ID,
          secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
          forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
        })
      : createStorageService({
          driver: 'local',
          dir: env.STORAGE_LOCAL_DIR,
          signingSecret: env.STORAGE_SIGNING_SECRET,
          apiPublicUrl: env.API_PUBLIC_URL,
        });
  return { provider, storage };
}

export async function processDocument(job: Job<DocumentProcessingJob>): Promise<void> {
  const { organizationId, documentId, requestedByUserId } = job.data;
  const { provider: aiProvider, storage: store } = deps();

  await withOrgContext(organizationId, (db) =>
    runExtractionPipeline(
      db,
      { provider: aiProvider, fetchBytes: (key) => store.get(key) },
      {
        organizationId,
        documentId,
        actorUserId: requestedByUserId,
        requestId: `job:${job.id ?? 'unknown'}`,
      },
    ),
  );
}
