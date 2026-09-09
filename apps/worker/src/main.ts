import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { pino } from 'pino';
import { loadEnv } from '@trace/config';
import { QUEUES, type DocumentProcessingJob, type NotificationJob } from './queues';
import { processDocument } from './processors/document-processing';
import { runWebhookDispatchPass } from './processors/webhook-dispatch';
import { runRetentionSweep } from './processors/retention';
import { runUsageRollForward } from './processors/usage';

const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, name: 'worker' });

// BullMQ requires `maxRetriesPerRequest: null` on the shared connection.
const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
connection.on('error', (err) =>
  log.warn({ err: err.message }, 'redis connection error (is Redis running?)'),
);

/** Producer handle other processes import via a shared package later. */
export const notificationsQueue = new Queue<NotificationJob>(QUEUES.notifications, { connection });

const notificationsWorker = new Worker<NotificationJob>(
  QUEUES.notifications,
  async (job) => {
    // Phase 1: acknowledge only. Real handlers land with their phases.
    log.info({ jobId: job.id, kind: job.data.kind }, 'notification job received');
  },
  { connection, concurrency: 5 },
);

notificationsWorker.on('ready', () => log.info('notifications worker ready'));
notificationsWorker.on('failed', (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, 'notification job failed'),
);
notificationsWorker.on('error', (err) => log.warn({ err: err.message }, 'worker error'));

export const documentProcessingQueue = new Queue<DocumentProcessingJob>(QUEUES.documentProcessing, {
  connection,
});

const documentWorker = new Worker<DocumentProcessingJob>(
  QUEUES.documentProcessing,
  async (job) => {
    log.info({ jobId: job.id, documentId: job.data.documentId }, 'document processing started');
    await processDocument(job);
    log.info({ jobId: job.id, documentId: job.data.documentId }, 'document processing done');
  },
  { connection, concurrency: 2 },
);
documentWorker.on('ready', () => log.info('document-processing worker ready'));
documentWorker.on('failed', (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, 'document processing failed'),
);
documentWorker.on('error', (err) => log.warn({ err: err.message }, 'document worker error'));

// Outbound webhooks (Phase 13). A DB-backed sweep, not a Redis queue: deliveries
// are rows written in the same transaction as the audit entry that triggered
// them, so they survive a Redis outage. One pass every WEBHOOK_DISPATCH_INTERVAL.
const WEBHOOK_DISPATCH_INTERVAL_MS = 15_000;
let webhookPassRunning = false;
const webhookTimer = setInterval(() => {
  if (webhookPassRunning) return;
  webhookPassRunning = true;
  runWebhookDispatchPass()
    .then((r) => {
      if (r.attempted > 0) log.info(r, 'webhook dispatch pass');
    })
    .catch((err) =>
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'webhook dispatch pass failed',
      ),
    )
    .finally(() => {
      webhookPassRunning = false;
    });
}, WEBHOOK_DISPATCH_INTERVAL_MS);
webhookTimer.unref();

// Retention sweep (Phase 13b): a periodic *dry-run* over every org's enabled
// policies so admins can see what would be purged. Deletion is always manual.
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000;
let retentionSweepRunning = false;
const retentionTimer = setInterval(() => {
  if (retentionSweepRunning) return;
  retentionSweepRunning = true;
  runRetentionSweep()
    .then((r) => {
      if (r.policies > 0) log.info(r, 'retention dry-run sweep');
    })
    .catch((err) =>
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'retention sweep failed'),
    )
    .finally(() => {
      retentionSweepRunning = false;
    });
}, RETENTION_SWEEP_INTERVAL_MS);
retentionTimer.unref();

// Usage period roll-forward (Phase 13c): advance each org's billing-period
// cursor at the month boundary. Cheap; a no-op mid-month.
const USAGE_ROLLFORWARD_INTERVAL_MS = 6 * 60 * 60_000;
let usageRollRunning = false;
const usageTimer = setInterval(() => {
  if (usageRollRunning) return;
  usageRollRunning = true;
  runUsageRollForward()
    .catch((err) =>
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'usage roll-forward failed',
      ),
    )
    .finally(() => {
      usageRollRunning = false;
    });
}, USAGE_ROLLFORWARD_INTERVAL_MS);
usageTimer.unref();

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down worker');
  clearInterval(webhookTimer);
  clearInterval(retentionTimer);
  clearInterval(usageTimer);
  await Promise.all([notificationsWorker.close(), documentWorker.close()]);
  await Promise.all([notificationsQueue.close(), documentProcessingQueue.close()]);
  await connection.quit().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

log.info(`TRACE worker started; queues: ${Object.values(QUEUES).join(', ')}`);
