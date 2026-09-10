import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  benchmarkComparison,
  benchmarkPeriod,
  createPrisma,
  provisionOrganization,
  refreshBenchmarkBuckets,
  setBenchmarkSettings,
  withOrgContext,
  type PrismaClient,
  type TenantDb,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

async function seedSnapshot(
  db: TenantDb,
  organizationId: string,
  userId: string,
  attributedPct: number,
  evidencePct: number,
): Promise<void> {
  await db.carbonGraphSnapshot.create({
    data: {
      organizationId,
      version: 1,
      builderVersion: 'carbon-graph@1.0.0',
      reportingPeriod: 'FY2024',
      data: { graph: { totals: { evidenceBackedPct: evidencePct } }, hotspots: {} },
      nodeCount: 2,
      edgeCount: 1,
      totalTco2e: '100.000000',
      attributedPct,
      hotspotCount: 1,
      computedByUserId: userId,
    },
  });
}

run('Cross-tenant benchmarking', () => {
  let prisma: PrismaClient;
  const period = benchmarkPeriod(new Date());
  const orgs = Array.from({ length: 6 }, () => randomUUID());
  const users = orgs.map(() => randomUUID());
  const soloOrg = randomUUID();
  const soloUser = randomUUID();

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [...orgs, soloOrg].map((_, i) => ({
        id: i < orgs.length ? users[i]! : soloUser,
        email: `bm-${i}-${randomUUID()}@test.example`,
        name: 'U',
      })),
    });

    for (let i = 0; i < orgs.length; i += 1) {
      const org = orgs[i]!;
      const user = users[i]!;
      await withOrgContext(
        org,
        async (db) => {
          await provisionOrganization(db, {
            organizationId: org,
            slug: `bm-${org.slice(0, 8)}`,
            legalName: 'BmCo',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          });
          // attributedPct 40..90 in steps of 10 → median 65
          await seedSnapshot(db, org, user, 40 + i * 10, 50 + i * 5);
          await setBenchmarkSettings(db, {
            organizationId: org,
            sector: 'manufacturing',
            optIn: true,
            actorUserId: user,
            requestId: 'test',
          });
        },
        prisma,
      );
    }

    await withOrgContext(
      soloOrg,
      async (db) => {
        await provisionOrganization(db, {
          organizationId: soloOrg,
          slug: `bm-solo-${soloOrg.slice(0, 8)}`,
          legalName: 'SoloCo',
          country: 'DE',
          creatorUserId: soloUser,
          requestId: 'test',
        });
        await seedSnapshot(db, soloOrg, soloUser, 30, 30);
        await setBenchmarkSettings(db, {
          organizationId: soloOrg,
          sector: 'retail',
          optIn: true,
          actorUserId: soloUser,
          requestId: 'test',
        });
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('refuses opt-in without a sector', async () => {
    await expect(
      withOrgContext(
        orgs[0]!,
        (db) =>
          setBenchmarkSettings(db, {
            organizationId: orgs[0]!,
            sector: null,
            optIn: true,
            actorUserId: users[0]!,
            requestId: 'test',
          }),
        prisma,
      ),
    ).rejects.toThrow(/sector/i);
    // restore
    await withOrgContext(
      orgs[0]!,
      (db) =>
        setBenchmarkSettings(db, {
          organizationId: orgs[0]!,
          sector: 'manufacturing',
          optIn: true,
          actorUserId: users[0]!,
          requestId: 'test',
        }),
      prisma,
    );
  });

  it('publishes a bucket above the k-anonymity threshold, suppresses below it', async () => {
    const res = await refreshBenchmarkBuckets(prisma, { period });
    expect(res.contributingOrgs).toBeGreaterThanOrEqual(7);

    const mfg = await prisma.benchmarkBucket.findUnique({
      where: {
        sector_metric_period: { sector: 'manufacturing', metric: 'primary_data_share_pct', period },
      },
    });
    expect(mfg?.suppressed).toBe(false);
    expect(mfg?.contributors).toBe(6);
    // nearest-rank on [40,50,60,70,80,90]: p25 → idx 1 = 50, p50 → idx 2 = 60, p75 → idx 4 = 80
    expect(Number(mfg?.p25)).toBe(50);
    expect(Number(mfg?.median)).toBe(60);
    expect(Number(mfg?.p75)).toBe(80);
    expect(Number(mfg?.min)).toBe(40);
    expect(Number(mfg?.max)).toBe(90);

    const retail = await prisma.benchmarkBucket.findUnique({
      where: {
        sector_metric_period: { sector: 'retail', metric: 'primary_data_share_pct', period },
      },
    });
    expect(retail?.suppressed).toBe(true);
    expect(retail?.median).toBeNull();
  });

  it('compares an org to its sector bucket without leaking peers', async () => {
    const view = await withOrgContext(
      orgs[5]!, // attributedPct 90 → ahead of the 65 median
      (db) => benchmarkComparison(db, orgs[5]!, period),
      prisma,
    );
    expect(view.eligible).toBe(true);
    expect(view.sector).toBe('manufacturing');
    expect(view.contributors).toBe(6);
    const primary = view.metrics.find((m) => m.metric === 'primary_data_share_pct')!;
    expect(primary.own).toBe(90);
    expect(primary.standing).toBe('ahead');
    // the response carries only aggregate stats, never a per-org list
    expect(JSON.stringify(view)).not.toContain(orgs[0]!);
  });

  it('an org with no sector is not eligible', async () => {
    const org = randomUUID();
    const user = randomUUID();
    await prisma.user.create({ data: { id: user, email: `bm-x-${user}@test.example`, name: 'X' } });
    await withOrgContext(
      org,
      (db) =>
        provisionOrganization(db, {
          organizationId: org,
          slug: `bm-x-${org.slice(0, 8)}`,
          legalName: 'X',
          country: 'DE',
          creatorUserId: user,
          requestId: 'test',
        }),
      prisma,
    );
    const view = await withOrgContext(org, (db) => benchmarkComparison(db, org), prisma);
    expect(view.eligible).toBe(false);
    expect(view.reason).toBe('no_sector');
  });
});
