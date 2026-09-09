import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  commitImport,
  createIntegration,
  createPrisma,
  integrationRunById,
  listIntegrationRuns,
  listIntegrations,
  previewImport,
  provisionOrganization,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

const MAPPING = {
  scope: { column: 'scope' },
  category: { column: 'category' },
  value: { column: 'value' },
  unit: { column: 'unit' },
  reportingPeriod: { column: 'period' },
  subjectType: { column: 'subject_type' },
  subjectId: { column: 'subject_id' },
  provenance: { column: 'provenance' },
};

run('integrations: CSV activity-data import (preview + commit)', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let integrationId = '';
  let csv = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `ia-${userA}@test.example`, name: 'A' },
        { id: userB, email: `ib-${userB}@test.example`, name: 'B' },
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
            slug: `i-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }

    csv =
      `scope,category,value,unit,period,subject_type,subject_id,provenance\n` +
      `scope_2_location,Electricity — Hamburg,3200000,kWh,FY2025,organization,${orgA},measured\n` +
      `scope_1,Gas — Hamburg,880000,kWh,FY2025,organization,${orgA},measured\n` +
      `scope_3,Steel,1000,t,FY2025,organization,${orgA},supplier_reported\n` +
      `scope_1,Bad row,50,widgets,FY2025,organization,${orgA},measured\n`;

    integrationId = await withOrgContext(
      orgA,
      async (db) => {
        const r = await createIntegration(db, {
          organizationId: orgA,
          kind: 'csv_activity',
          name: 'Facility energy CSV',
          config: { mapping: MAPPING },
          actorUserId: userA,
          requestId: 'test',
        });
        return r.id;
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('previews without writing anything', () => {
    const p = previewImport('csv_activity', csv, MAPPING, {});
    expect(p.summary).toEqual({ total: 4, valid: 3, invalid: 1 });
    expect(p.rows[3]!.errors.join()).toMatch(/unit registry/i);
    expect(p.rows[0]!.mapped).toMatchObject({
      scope: 'scope_2_location',
      value: 3200000,
      unit: 'kWh',
    });
  });

  it('rejects an unknown adapter kind', () => {
    expect(() => previewImport('sap_pull', csv, {}, {})).toThrow(/Unknown integration kind/);
  });

  it('commits the valid rows as activity data', async () => {
    const checksum = createHash('sha256').update(csv, 'utf8').digest('hex');
    const result = await withOrgContext(
      orgA,
      (db) =>
        commitImport(db, {
          organizationId: orgA,
          kind: 'csv_activity',
          integrationId,
          fileName: 'energy.csv',
          fileChecksum: checksum,
          text: csv,
          mapping: MAPPING,
          defaults: {},
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(result.status).toBe('completed');
    expect(result.rowsTotal).toBe(4);
    expect(result.rowsValid).toBe(3);
    expect(result.rowsInvalid).toBe(1);
    expect(result.rowsImported).toBe(3);
    expect(result.createdActivityIds).toHaveLength(3);
    expect(result.rowErrors).toEqual([]);

    const { activities, runRow, integration } = await withOrgContext(
      orgA,
      async (db) => ({
        activities: await db.activityData.findMany({
          where: { id: { in: result.createdActivityIds } },
          orderBy: { createdAt: 'asc' },
        }),
        runRow: await db.integrationRun.findUnique({ where: { id: result.runId } }),
        integration: await db.integration.findUnique({ where: { id: integrationId } }),
      }),
      prisma,
    );
    expect(activities).toHaveLength(3);
    expect(activities.every((a) => a.sourceRef?.startsWith(`import:${result.runId}:`))).toBe(true);
    expect(activities.find((a) => a.unit === 't')?.provenance).toBe('supplier_reported');
    expect(activities.find((a) => a.category === 'Electricity — Hamburg')?.value.toString()).toBe(
      '3200000',
    );
    expect(runRow?.status).toBe('completed');
    expect((runRow?.preview as unknown[]).length).toBe(4);
    expect(integration?.lastRunAt).not.toBeNull();
  });

  it('records the run in history and keeps a verifiable audit chain', async () => {
    const runs = await withOrgContext(orgA, (db) => listIntegrationRuns(db, orgA), prisma);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const detail = await withOrgContext(
      orgA,
      (db) => integrationRunById(db, orgA, runs[0]!.id as string),
      prisma,
    );
    expect(detail.rowsImported).toBe(3);

    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
  });

  it('is tenant-isolated (RLS)', async () => {
    const [conns, count] = await withOrgContext(
      orgB,
      async (db) => [await listIntegrations(db, orgB), await db.integrationRun.count()],
      prisma,
    );
    expect(conns).toEqual([]);
    expect(count).toBe(0);
  });
});
