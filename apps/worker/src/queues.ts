/**
 * Queue registry. Phase 5 adds `document-processing` — the async path for the AI
 * extraction pipeline (the API can also run it synchronously). Later phases add
 * calculation, report-generation, and notification queues (brief §31).
 */
export const QUEUES = {
  notifications: 'trace.notifications',
  documentProcessing: 'trace.document-processing',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface NotificationJob {
  kind: string;
  organizationId: string | null;
  payload: Record<string, unknown>;
}

export interface DocumentProcessingJob {
  organizationId: string;
  documentId: string;
  requestedByUserId: string;
}
