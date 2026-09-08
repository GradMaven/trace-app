/**
 * Queue registry. Phase 1 defines the transport and one no-op queue so the
 * process, its wiring, and observability exist; document processing, extraction,
 * calculation, report generation, and notification queues arrive with their
 * phases (see docs/roadmap.md, brief §31).
 */
export const QUEUES = {
  notifications: 'trace.notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface NotificationJob {
  kind: string;
  organizationId: string | null;
  payload: Record<string, unknown>;
}
