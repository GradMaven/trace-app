import { describe, expect, it } from 'vitest';
import {
  buildWebhookEventPayload,
  isRetryableWebhookStatus,
  signWebhookBody,
  verifyWebhookSignature,
  webhookEventForAuditAction,
  webhookNextAttemptAt,
  WEBHOOK_MAX_ATTEMPTS,
} from './webhook';

describe('webhookEventForAuditAction', () => {
  it('maps known audit actions to events', () => {
    expect(webhookEventForAuditAction('evidence.transitioned.verified')).toBe('evidence.verified');
    expect(webhookEventForAuditAction('calculation.approved')).toBe('calculation.approved');
    expect(webhookEventForAuditAction('integration.import_completed')).toBe(
      'integration.import_completed',
    );
  });
  it('returns null for actions that are not webhook events', () => {
    expect(webhookEventForAuditAction('activity.updated')).toBeNull();
    expect(webhookEventForAuditAction('seed.completed')).toBeNull();
  });
});

describe('signWebhookBody / verifyWebhookSignature', () => {
  const secret = 'whsec_test_1234567890';
  const body = JSON.stringify({ hello: 'world' });

  it('produces a t=,v1= header that verifies with the same secret and body', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const ts = Math.floor(now.getTime() / 1000);
    const header = signWebhookBody(secret, ts, body);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, header, body, now)).toBe(true);
  });

  it('fails for a tampered body, wrong secret, or stale timestamp', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    const ts = Math.floor(now.getTime() / 1000);
    const header = signWebhookBody(secret, ts, body);
    expect(verifyWebhookSignature(secret, header, body + ' ', now)).toBe(false);
    expect(verifyWebhookSignature('other', header, body, now)).toBe(false);
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(verifyWebhookSignature(secret, header, body, later)).toBe(false);
  });
});

describe('retry schedule', () => {
  it('backs off and caps at WEBHOOK_MAX_ATTEMPTS entries', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    const d1 = webhookNextAttemptAt(1, from).getTime() - from.getTime();
    const d2 = webhookNextAttemptAt(2, from).getTime() - from.getTime();
    const d6 = webhookNextAttemptAt(6, from).getTime() - from.getTime();
    expect(d1).toBe(0);
    expect(d2).toBeGreaterThan(d1);
    expect(d6).toBeGreaterThan(d2);
    // out-of-range attempt numbers clamp, never throw
    expect(webhookNextAttemptAt(99, from).getTime()).toBe(
      webhookNextAttemptAt(WEBHOOK_MAX_ATTEMPTS, from).getTime(),
    );
  });

  it('classifies HTTP statuses', () => {
    expect(isRetryableWebhookStatus(200)).toBe(false);
    expect(isRetryableWebhookStatus(204)).toBe(false);
    expect(isRetryableWebhookStatus(400)).toBe(false);
    expect(isRetryableWebhookStatus(404)).toBe(false);
    expect(isRetryableWebhookStatus(429)).toBe(true);
    expect(isRetryableWebhookStatus(500)).toBe(true);
    expect(isRetryableWebhookStatus(503)).toBe(true);
  });
});

describe('buildWebhookEventPayload', () => {
  it('wraps the audit after-snapshot in a stable envelope', () => {
    const p = buildWebhookEventPayload({
      deliveryId: 'dlv_1',
      event: 'calculation.approved',
      organizationId: 'org_1',
      occurredAt: new Date('2026-06-01T00:00:00Z'),
      resourceType: 'calculation',
      resourceId: 'calc_1',
      data: { approvedBy: 'u_1' },
    });
    expect(p).toEqual({
      id: 'dlv_1',
      event: 'calculation.approved',
      organizationId: 'org_1',
      occurredAt: '2026-06-01T00:00:00.000Z',
      resource: { type: 'calculation', id: 'calc_1' },
      data: { approvedBy: 'u_1' },
    });
  });
});
