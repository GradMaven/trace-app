import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { pino } from 'pino';
import { loadEnv } from '@trace/config';
import { QUEUES, type NotificationJob } from './queues';

const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, name: 'worker' });

// BullMQ requires `maxRetriesPerRequest: null` on the shared connection.
const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
connection.on('error', (err) => log.warn({ err: err.message }, 'redis connection error (is Redis running?)'));

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

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down worker');
  await notificationsWorker.close();
  await notificationsQueue.close();
  await connection.quit().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

log.info(`TRACE worker started; queues: ${Object.values(QUEUES).join(', ')}`);
