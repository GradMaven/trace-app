import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCodeAt } from '@trace/domain';
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  createPrisma,
  createWebhookEndpoint,
  disableMfa,
  exportJobById,
  getMfaStatus,
  listExportJobs,
  listRetentionPolicies,
  provisionOrganization,
  resolveMfaRequirement,
  runExport,
  runRetention,
  upsertRetentionPolicy,
  verifyAuditChain,
  verifyMfaChallenge,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('governance: MFA + data export + retention', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `ga-${userA}@test.example`, name: 'A' },
        { id: userB, email: `gb-${userB}@test.example`, name: 'B' },
      ],
    });
    for (const [org, user] of [
      [orgA, userA],
      [orgB, userB],
    ] as const) {
      await withOrgContext(
        org,
        (db) =>
          provisionOrganization(db, {
            organizationId: org,
            slug: `g-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('enrols, challenges and disables TOTP two-factor', async () => {
    const { secret } = await beginMfaEnrollment(prisma, userA, 'a@test.example');
    expect((await getMfaStatus(prisma, userA)).pending).toBe(true);

    await expect(confirmMfaEnrollment(prisma, { userId: userA, code: '000000' })).rejects.toThrow(
      /not valid/i,
    );

    const { recoveryCodes } = await confirmMfaEnrollment(prisma, {
      userId: userA,
      code: totpCodeAt(secret, new Date()),
      organizationId: orgA,
      requestId: 'test',
    });
    expect(recoveryCodes).toHaveLength(10);
    expect((await getMfaStatus(prisma, userA)).enrolled).toBe(true);

    // TOTP challenge
    const totp = await verifyMfaChallenge(prisma, {
      userId: userA,
      code: totpCodeAt(secret, new Date()),
    });
    expect(totp.ok).toBe(true);
    expect(totp.usedRecoveryCode).toBe(false);

    // recovery code — single use
    const rc = recoveryCodes[0]!;
    const first = await verifyMfaChallenge(prisma, { userId: userA, code: rc });
    expect(first).toMatchObject({ ok: true, usedRecoveryCode: true, recoveryCodesRemaining: 9 });
    const second = await verifyMfaChallenge(prisma, { userId: userA, code: rc });
    expect(second.ok).toBe(false);

    expect(await resolveMfaRequirement(prisma, userA, orgA)).toMatchObject({
      mustSatisfy: true,
      enrolled: true,
    });

    await disableMfa(prisma, {
      userId: userA,
      code: totpCodeAt(secret, new Date()),
      organizationId: orgA,
      requestId: 'test',
    });
    expect((await getMfaStatus(prisma, userA)).enrolled).toBe(false);
  });

  it('mandates MFA for members when the org requires it', async () => {
    await withOrgContext(
      orgA,
      (db) => db.organization.update({ where: { id: orgA }, data: { requireMfa: true } }),
      prisma,
    );
    const req = await resolveMfaRequirement(prisma, userB, orgA);
    expect(req).toMatchObject({ mustSatisfy: true, enrolled: false, orgMandates: true });
    await withOrgContext(
      orgA,
      (db) => db.organization.update({ where: { id: orgA }, data: { requireMfa: false } }),
      prisma,
    );
  });

  it('produces a content-addressed full-tenant export bundle', async () => {
    let uploaded: Buffer | null = null;
    let uploadedKey = '';
    const result = await withOrgContext(
      orgA,
      (db) =>
        runExport(
          db,
          {
            driver: 'local',
            putBytes: async (key, bytes) => {
              uploadedKey = key;
              uploaded = bytes;
            },
          },
          { organizationId: orgA, actorUserId: userA, requestId: 'test' },
        ),
      prisma,
    );
    expect(result.status).toBe('ready');
    expect(uploaded).not.toBeNull();
    expect(createHash('sha256').update(uploaded!).digest('hex')).toBe(result.sha256);
    expect(uploadedKey).toBe(`exports/${orgA}/${result.sha256}/export.json`);
    expect(result.sectionCounts.organization).toBe(1);
    expect(result.sectionCounts.audit_log).toBeGreaterThan(0);
    expect(result.totalRecords).toBe(
      Object.values(result.sectionCounts).reduce((a, b) => a + b, 0),
    );

    const jobs = await withOrgContext(orgA, (db) => listExportJobs(db, orgA), prisma);
    expect(jobs[0]!.status).toBe('ready');
    const detail = await withOrgContext(orgA, (db) => exportJobById(db, orgA, jobs[0]!.id), prisma);
    expect(detail.storageKey).toBe(uploadedKey);
  });

  it('runs retention as dry-run then apply, and honours legal hold', async () => {
    const { id: endpointId } = await withOrgContext(
      orgA,
      (db) =>
        createWebhookEndpoint(db, {
          organizationId: orgA,
          url: 'https://example.test/h',
          events: ['calculation.approved'],
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const old = new Date(Date.now() - 200 * 24 * 3600_000);
    await withOrgContext(
      orgA,
      async (db) => {
        for (let i = 0; i < 3; i += 1) {
          await db.webhookDelivery.create({
            data: {
              organizationId: orgA,
              endpointId,
              event: 'calculation.approved',
              payload: {},
              status: 'dead',
              createdAt: i < 2 ? old : new Date(),
            },
          });
        }
      },
      prisma,
    );

    await withOrgContext(
      orgA,
      (db) =>
        upsertRetentionPolicy(db, {
          organizationId: orgA,
          target: 'webhook_delivery',
          ageDays: 90,
          enabled: true,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );

    const dry = await withOrgContext(
      orgA,
      (db) =>
        runRetention(db, {
          organizationId: orgA,
          target: 'webhook_delivery',
          mode: 'dry_run',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(dry[0]).toMatchObject({ matched: 2, deleted: 0 });

    // legal hold blocks apply
    await withOrgContext(
      orgA,
      (db) => db.organization.update({ where: { id: orgA }, data: { legalHold: true } }),
      prisma,
    );
    await expect(
      withOrgContext(
        orgA,
        (db) =>
          runRetention(db, {
            organizationId: orgA,
            target: 'webhook_delivery',
            mode: 'apply',
            actorUserId: userA,
            requestId: 'test',
          }),
        prisma,
      ),
    ).rejects.toThrow(/legal hold/i);
    await withOrgContext(
      orgA,
      (db) => db.organization.update({ where: { id: orgA }, data: { legalHold: false } }),
      prisma,
    );

    const applied = await withOrgContext(
      orgA,
      (db) =>
        runRetention(db, {
          organizationId: orgA,
          target: 'webhook_delivery',
          mode: 'apply',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(applied[0]).toMatchObject({ matched: 2, deleted: 2 });
    const left = await withOrgContext(
      orgA,
      (db) => db.webhookDelivery.count({ where: { organizationId: orgA, endpointId } }),
      prisma,
    );
    expect(left).toBe(1);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bExports = await withOrgContext(orgB, (db) => listExportJobs(db, orgB), prisma);
    const bPolicies = await withOrgContext(orgB, (db) => listRetentionPolicies(db, orgB), prisma);
    expect(bExports).toEqual([]);
    expect(bPolicies).toEqual([]);
    const counts = await withOrgContext(
      orgB,
      async (db) => [await db.exportJob.count(), await db.retentionPolicy.count()],
      prisma,
    );
    expect(counts).toEqual([0, 0]);
  });
});
