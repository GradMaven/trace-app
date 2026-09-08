/**
 * TRACE demo seed — Phase 1 slice.
 *
 * Creates the demo tenant **NordWerk Manufacturing AG** (Germany, industrial
 * manufacturing) with a permission catalog, default roles, and a handful of
 * members and business units. Later phases extend this seed with suppliers,
 * facilities, materials, products, activity data, calculations, evidence,
 * compliance gaps, and audit findings.
 *
 * Everything created here is explicitly demo data (see the `demo:` flags and
 * the `.example` email domain). Idempotent: re-running skips an existing tenant.
 *
 * Run: `pnpm db:seed`
 */
import { QUESTIONNAIRE_VERSION } from '@trace/domain';
import type { Prisma } from './index';
import {
  disconnectPrisma,
  ensurePermissionCatalog,
  ensurePlatformRole,
  getPrisma,
  provisionOrganization,
  recomputeEmissions,
  recomputeSupplierPassport,
  runCalculation,
  transitionEvidence,
  withOrgContext,
  withPlatformContext,
  writeAuditLog,
} from './index';

const DEMO = {
  organizationId: '00000000-0000-4000-8000-0000000000d1',
  slug: 'nordwerk',
  legalName: 'NordWerk Manufacturing AG',
  country: 'DE',
  users: {
    admin: {
      id: '00000000-0000-4000-8000-0000000000a1',
      email: 'anke.roth@nordwerk.example',
      name: 'Anke Roth',
    },
    analyst: {
      id: '00000000-0000-4000-8000-0000000000a2',
      email: 'jonas.pfeiffer@nordwerk.example',
      name: 'Jonas Pfeiffer',
    },
    auditor: {
      id: '00000000-0000-4000-8000-0000000000a3',
      email: 'external.auditor@pruefwerk.example',
      name: 'Dr. Petra Vogel',
    },
  },
} as const;

async function main(): Promise<void> {
  const prisma = getPrisma({ datasourceUrl: process.env.DATABASE_URL });

  const existing = await prisma.organization.findUnique({ where: { slug: DEMO.slug } });
  if (existing) {
    console.warn(`[seed] Organization "${DEMO.slug}" already exists (${existing.id}). Nothing to do.`);
    return;
  }

  // 1. Global catalog + platform role.
  await withPlatformContext(async (db) => {
    await ensurePermissionCatalog(db);
    await ensurePlatformRole(db);
  });
  console.warn('[seed] Permission catalog and platform role ensured.');

  // 2. Users (platform-level identity).
  for (const u of Object.values(DEMO.users)) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { id: u.id, email: u.email, name: u.name },
      update: { name: u.name },
    });
  }
  console.warn('[seed] Demo users created.');

  // 3. Provision the organization (org + roles + creator membership + audit).
  const provisioned = await withOrgContext(DEMO.organizationId, (db) =>
    provisionOrganization(db, {
      organizationId: DEMO.organizationId,
      slug: DEMO.slug,
      legalName: DEMO.legalName,
      country: DEMO.country,
      creatorUserId: DEMO.users.admin.id,
      requestId: 'seed',
    }),
  );
  console.warn(`[seed] Organization provisioned: ${DEMO.legalName} (${DEMO.organizationId}).`);

  // 4. Business units + extra members + a pending invitation.
  await withOrgContext(DEMO.organizationId, async (db) => {
    const hq = await db.businessUnit.create({
      data: { organizationId: DEMO.organizationId, name: 'Group Functions' },
    });
    await db.businessUnit.createMany({
      data: [
        { organizationId: DEMO.organizationId, name: 'Operations — Powertrain', parentId: hq.id },
        { organizationId: DEMO.organizationId, name: 'Operations — Structures', parentId: hq.id },
      ],
    });

    const analystMembership = await db.membership.create({
      data: {
        organizationId: DEMO.organizationId,
        userId: DEMO.users.analyst.id,
        status: 'active',
        roles: { create: [{ roleId: provisioned.roleIdsByKey['esg_analyst']! }] },
      },
    });
    const auditorMembership = await db.membership.create({
      data: {
        organizationId: DEMO.organizationId,
        userId: DEMO.users.auditor.id,
        status: 'active',
        roles: { create: [{ roleId: provisioned.roleIdsByKey['auditor']! }] },
      },
    });

    await db.invitation.create({
      data: {
        organizationId: DEMO.organizationId,
        email: 'procurement.lead@nordwerk.example',
        roleKeys: ['procurement_manager'],
        invitedByUserId: DEMO.users.admin.id,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await writeAuditLog(db, {
      organizationId: DEMO.organizationId,
      actorId: DEMO.users.admin.id,
      action: 'seed.completed',
      resourceType: 'organization',
      resourceId: DEMO.organizationId,
      before: null,
      after: {
        businessUnits: 3,
        memberships: [analystMembership.id, auditorMembership.id].length + 1,
        invitationsPending: 1,
        demo: true,
      },
      requestId: 'seed',
    });
  });

  console.warn('[seed] Business units, members, and a pending invitation created.');

  await seedSuppliers();
  console.warn('[seed] Suppliers, relationships, questionnaires, and passports created.');

  await seedEvidence();
  console.warn('[seed] Evidence records and linked datapoints created.');

  await seedCarbon();
  console.warn('[seed] Emission factors, activity data, calculations, and FY2025 emissions created.');
  console.warn('[seed] Done. Sign in as anke.roth@nordwerk.example (magic link printed by the API).');
}

const LIBRARY_FACTORS: Array<{
  sourceRef: string;
  name: string;
  value: number;
  numeratorUnit: 'kgCO2e' | 'tCO2e';
  denominatorUnit: string;
  activityDimension: string;
  scope: string;
  ghgCategory: string | null;
  geography: string | null;
  methodology: string | null;
}> = [
  {
    sourceRef: 'steel-crude-de',
    name: 'Crude steel — Germany (illustrative)',
    value: 2.1,
    numeratorUnit: 'tCO2e',
    denominatorUnit: 't',
    activityDimension: 'mass',
    scope: 'scope_3',
    ghgCategory: 'cat_1_purchased_goods_services',
    geography: 'DE',
    methodology: 'average_data',
  },
  {
    sourceRef: 'electricity-grid-de-location',
    name: 'Grid electricity — Germany, location-based (illustrative)',
    value: 0.38,
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 'kWh',
    activityDimension: 'energy',
    scope: 'scope_2_location',
    ghgCategory: null,
    geography: 'DE',
    methodology: 'average_data',
  },
  {
    sourceRef: 'electricity-grid-de-market',
    name: 'Residual mix electricity — Germany, market-based (illustrative)',
    value: 0.42,
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 'kWh',
    activityDimension: 'energy',
    scope: 'scope_2_market',
    ghgCategory: null,
    geography: 'DE',
    methodology: 'average_data',
  },
  {
    sourceRef: 'natural-gas-combustion',
    name: 'Natural gas combustion (illustrative)',
    value: 0.184,
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 'kWh',
    activityDimension: 'energy',
    scope: 'scope_1',
    ghgCategory: null,
    geography: null,
    methodology: 'fuel_based',
  },
  {
    sourceRef: 'diesel-combustion',
    name: 'Diesel combustion, stationary + mobile (illustrative)',
    value: 2.68,
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 'L',
    activityDimension: 'volume',
    scope: 'scope_1',
    ghgCategory: null,
    geography: null,
    methodology: 'fuel_based',
  },
  {
    sourceRef: 'road-freight-hgv',
    name: 'Road freight, average HGV (illustrative)',
    value: 0.107,
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 't.km',
    activityDimension: 'freight',
    scope: 'scope_3',
    ghgCategory: 'cat_4_upstream_transportation',
    geography: null,
    methodology: 'distance_based',
  },
  {
    sourceRef: 'air-travel-long-haul',
    name: 'Air travel, long-haul economy (illustrative)',
    value: 0.15,
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 'p.km',
    activityDimension: 'passenger_distance',
    scope: 'scope_3',
    ghgCategory: 'cat_6_business_travel',
    geography: null,
    methodology: 'distance_based',
  },
  {
    sourceRef: 'eeio-purchased-services-eur',
    name: 'Spend-based EEIO — purchased services, EUR (illustrative)',
    value: 0.28,
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 'EUR',
    activityDimension: 'currency',
    scope: 'scope_3',
    ghgCategory: 'cat_1_purchased_goods_services',
    geography: null,
    methodology: 'spend_based',
  },
];

async function seedCarbon(): Promise<void> {
  const orgId = DEMO.organizationId;
  const analystId = DEMO.users.analyst.id;
  const adminId = DEMO.users.admin.id;

  await withOrgContext(orgId, async (db) => {
    // 1. Shared library factors (illustrative — not for statutory reporting).
    for (const f of LIBRARY_FACTORS) {
      await db.emissionFactor.create({
        data: {
          organizationId: null,
          source: 'TRACE-DEMO',
          sourceRef: f.sourceRef,
          name: f.name,
          value: f.value,
          numeratorUnit: f.numeratorUnit,
          denominatorUnit: f.denominatorUnit,
          activityDimension: f.activityDimension,
          gwpSet: 'AR6',
          scope: f.scope as never,
          ghgCategory: (f.ghgCategory as never) ?? null,
          geography: f.geography,
          methodology: (f.methodology as never) ?? null,
          validFrom: new Date('2024-01-01'),
          notes: 'Illustrative demo factor — replace with a licensed dataset before reporting.',
        },
      });
    }

    const rheinstahl = await db.supplier.findFirst({
      where: { organizationId: orgId, name: SUPPLIER_ROWS[0]!.name },
    });

    // 2. An organization-specific supplier factor (beats the library on selection).
    await db.emissionFactor.create({
      data: {
        organizationId: orgId,
        source: 'CUSTOM',
        sourceRef: 'rheinstahl-steel-2025',
        name: 'Rheinstahl steel — supplier-specific PCF (illustrative)',
        value: 2.05,
        numeratorUnit: 'tCO2e',
        denominatorUnit: 't',
        activityDimension: 'mass',
        gwpSet: 'AR6',
        scope: 'scope_3' as never,
        ghgCategory: 'cat_1_purchased_goods_services' as never,
        geography: 'DE',
        methodology: 'supplier_specific' as never,
        validFrom: new Date('2025-01-01'),
        notes: 'From the supplier questionnaire; illustrative.',
        createdByUserId: analystId,
      },
    });

    // 3. Activity data (FY2025).
    const activities: Array<{
      scope: string;
      ghgCategory: string | null;
      category: string;
      value: number;
      unit: string;
      subjectType: string;
      subjectId: string;
      supplierId?: string;
      description: string;
    }> = [
      {
        scope: 'scope_1',
        ghgCategory: null,
        category: 'Stationary combustion — natural gas',
        value: 4_200_000,
        unit: 'kWh',
        subjectType: 'organization',
        subjectId: orgId,
        description: 'HQ + Powertrain site heating',
      },
      {
        scope: 'scope_1',
        ghgCategory: null,
        category: 'Mobile combustion — diesel fleet',
        value: 180_000,
        unit: 'L',
        subjectType: 'organization',
        subjectId: orgId,
        description: 'Owned logistics fleet',
      },
      {
        scope: 'scope_2_location',
        ghgCategory: null,
        category: 'Purchased electricity (location-based)',
        value: 12_400_000,
        unit: 'kWh',
        subjectType: 'organization',
        subjectId: orgId,
        description: 'All German sites',
      },
      {
        scope: 'scope_2_market',
        ghgCategory: null,
        category: 'Purchased electricity (market-based)',
        value: 12_400_000,
        unit: 'kWh',
        subjectType: 'organization',
        subjectId: orgId,
        description: 'All German sites — residual mix',
      },
      {
        scope: 'scope_3',
        ghgCategory: 'cat_1_purchased_goods_services',
        category: 'Purchased steel — Rheinstahl',
        value: 1283,
        unit: 't',
        subjectType: 'supplier',
        subjectId: rheinstahl?.id ?? orgId,
        supplierId: rheinstahl?.id,
        description: 'Crude steel deliveries, FY2025',
      },
      {
        scope: 'scope_3',
        ghgCategory: 'cat_4_upstream_transportation',
        category: 'Upstream road freight',
        value: 2_400_000,
        unit: 't.km',
        subjectType: 'organization',
        subjectId: orgId,
        description: 'Inbound logistics, FY2025',
      },
    ];

    const rheinstahlEvidence = await db.evidence.findFirst({
      where: { organizationId: orgId, title: 'Rheinstahl Sustainability Report 2025' },
    });

    for (const a of activities) {
      const row = await db.activityData.create({
        data: {
          organizationId: orgId,
          scope: a.scope as never,
          ghgCategory: (a.ghgCategory as never) ?? null,
          category: a.category,
          description: a.description,
          value: a.value,
          unit: a.unit,
          reportingPeriod: 'FY2025',
          provenance: a.scope === 'scope_3' ? 'supplier_reported' : 'measured',
          subjectType: a.subjectType,
          subjectId: a.subjectId,
          supplierId: a.supplierId ?? null,
          occurredOn: new Date('2025-12-31'),
          createdByUserId: analystId,
        },
      });

      if (a.category.includes('Rheinstahl') && rheinstahlEvidence) {
        await db.activityEvidence.create({
          data: {
            organizationId: orgId,
            activityId: row.id,
            evidenceId: rheinstahlEvidence.id,
            linkedByUserId: analystId,
          },
        });
      }

      await runCalculation(db, {
        organizationId: orgId,
        activityId: row.id,
        actorUserId: analystId,
        requestId: 'seed',
      });
    }

    await recomputeEmissions(db, {
      organizationId: orgId,
      reportingPeriod: 'FY2025',
      actorUserId: adminId,
      requestId: 'seed',
    });

    await writeAuditLog(db, {
      organizationId: orgId,
      actorId: adminId,
      action: 'seed.carbon_completed',
      resourceType: 'organization',
      resourceId: orgId,
      before: null,
      after: { libraryFactors: LIBRARY_FACTORS.length, activities: activities.length, demo: true },
      requestId: 'seed',
    });
  });
}

async function seedEvidence(): Promise<void> {
  const orgId = DEMO.organizationId;
  const adminId = DEMO.users.admin.id;
  const analystId = DEMO.users.analyst.id;

  await withOrgContext(orgId, async (db) => {
    const rheinstahl = await db.supplier.findFirst({
      where: { organizationId: orgId, name: SUPPLIER_ROWS[0]!.name },
    });
    const nordicBearings = await db.supplier.findFirst({
      where: { organizationId: orgId, name: 'Nordic Bearings AB' },
    });
    if (!rheinstahl || !nordicBearings) return;

    // Promote Rheinstahl's supplier-submitted report into an Evidence record.
    const ref = await db.supplierEvidenceRef.findFirst({
      where: { organizationId: orgId, supplierId: rheinstahl.id },
    });

    const report = await db.evidence.create({
      data: {
        organizationId: orgId,
        type: 'supplier_report',
        title: 'Rheinstahl Sustainability Report 2025',
        source: 'supplier_portal',
        reportingPeriod: 'FY2025',
        issuer: 'Rheinstahl Walzwerke GmbH',
        hash: 'seed-evidence-rheinstahl-report-2025',
        metadata: { supplierId: rheinstahl.id, demo: true } as Prisma.InputJsonValue,
        status: 'uploaded',
        uploadedByUserId: adminId,
      },
    });
    if (ref) {
      await db.supplierEvidenceRef.update({
        where: { id: ref.id },
        data: { promotedEvidenceId: report.id, verified: true },
      });
    }

    const cert = await db.evidence.create({
      data: {
        organizationId: orgId,
        type: 'certificate',
        title: 'Nordic Bearings — ISO 14001 certificate',
        source: 'manual',
        reportingPeriod: 'FY2025',
        issuer: 'DNV',
        hash: 'seed-evidence-nordic-iso14001',
        metadata: { supplierId: nordicBearings.id, demo: true } as Prisma.InputJsonValue,
        status: 'uploaded',
        uploadedByUserId: analystId,
      },
    });

    // Move both through the lifecycle to "verified".
    for (const ev of [report, cert]) {
      await transitionEvidence(db, {
        organizationId: orgId,
        evidenceId: ev.id,
        to: 'reviewed',
        actorUserId: analystId,
        permissions: ['evidence.update'],
        requestId: 'seed',
      });
      await transitionEvidence(db, {
        organizationId: orgId,
        evidenceId: ev.id,
        to: 'verified',
        actorUserId: DEMO.users.auditor.id,
        permissions: ['evidence.verify'],
        method: 'document_review',
        note: 'Seed verification.',
        requestId: 'seed',
      });
    }

    // Datapoints backed by the verified evidence.
    const dp1 = await db.datapoint.create({
      data: {
        organizationId: orgId,
        metricKey: 'scope1_tco2e',
        valueNumeric: 128_400,
        unit: 'tCO2e',
        provenance: 'supplier_reported',
        label: 'verified',
        reportingPeriod: 'FY2025',
        subjectType: 'supplier',
        subjectId: rheinstahl.id,
        createdByUserId: analystId,
      },
    });
    const dp2 = await db.datapoint.create({
      data: {
        organizationId: orgId,
        metricKey: 'renewable_electricity_pct',
        valueNumeric: 48,
        unit: '%',
        provenance: 'supplier_reported',
        label: 'human_reviewed',
        reportingPeriod: 'FY2025',
        subjectType: 'supplier',
        subjectId: rheinstahl.id,
        createdByUserId: analystId,
      },
    });
    const dp3 = await db.datapoint.create({
      data: {
        organizationId: orgId,
        metricKey: 'iso14001_certified',
        valueText: 'true',
        provenance: 'supplier_reported',
        label: 'verified',
        reportingPeriod: 'FY2025',
        subjectType: 'supplier',
        subjectId: nordicBearings.id,
        createdByUserId: analystId,
      },
    });

    await db.datapointEvidence.createMany({
      data: [
        { organizationId: orgId, datapointId: dp1.id, evidenceId: report.id, linkedByUserId: analystId },
        { organizationId: orgId, datapointId: dp2.id, evidenceId: report.id, linkedByUserId: analystId },
        { organizationId: orgId, datapointId: dp3.id, evidenceId: cert.id, linkedByUserId: analystId },
      ],
    });

    await writeAuditLog(db, {
      organizationId: orgId,
      actorId: adminId,
      action: 'seed.evidence_completed',
      resourceType: 'organization',
      resourceId: orgId,
      before: null,
      after: { evidence: 2, datapoints: 3, verified: 2, demo: true },
      requestId: 'seed',
    });
  });
}

const SUPPLIER_ROWS: Array<{
  name: string;
  country: string;
  nace: string;
  category: string;
  tier: number;
  spend: number;
}> = [
  { name: 'Rheinstahl Walzwerke GmbH', country: 'DE', nace: '24.10', category: 'Steel', tier: 1, spend: 41_800_000 },
  { name: 'Aluminium Nord AS', country: 'NO', nace: '24.42', category: 'Aluminium', tier: 1, spend: 28_400_000 },
  { name: 'Polymères de la Loire SA', country: 'FR', nace: '20.16', category: 'Polymers', tier: 1, spend: 22_100_000 },
  { name: 'Iberia Fundición S.L.', country: 'ES', nace: '24.51', category: 'Castings', tier: 1, spend: 17_650_000 },
  { name: 'Baltic Wire Components UAB', country: 'LT', nace: '25.93', category: 'Fasteners', tier: 2, spend: 9_300_000 },
  { name: 'Vlaamse Coatings NV', country: 'BE', nace: '20.30', category: 'Coatings', tier: 2, spend: 7_900_000 },
  { name: 'Bohemia Precision Machining s.r.o.', country: 'CZ', nace: '25.62', category: 'Machining', tier: 2, spend: 12_400_000 },
  { name: 'Nordic Bearings AB', country: 'SE', nace: '28.15', category: 'Bearings', tier: 1, spend: 15_200_000 },
  { name: 'Adriatic Electronics d.o.o.', country: 'HR', nace: '26.11', category: 'Electronics', tier: 2, spend: 6_100_000 },
  { name: 'Helvetia Sensor Systems AG', country: 'CH', nace: '26.51', category: 'Sensors', tier: 1, spend: 13_750_000 },
  { name: 'Lisboa Cabos e Condutores SA', country: 'PT', nace: '27.32', category: 'Cabling', tier: 2, spend: 4_800_000 },
  { name: 'Magyar Öntöde Zrt.', country: 'HU', nace: '24.54', category: 'Castings', tier: 2, spend: 5_600_000 },
  { name: 'Green Logistics Benelux BV', country: 'NL', nace: '49.41', category: 'Logistics', tier: 1, spend: 19_900_000 },
  { name: 'Suomi Metalliteollisuus Oy', country: 'FI', nace: '25.11', category: 'Structural metal', tier: 1, spend: 11_050_000 },
  { name: 'Danube Rubber Technik GmbH', country: 'AT', nace: '22.19', category: 'Rubber parts', tier: 2, spend: 3_950_000 },
  { name: 'Éire Industrial Gases Ltd', country: 'IE', nace: '20.11', category: 'Industrial gases', tier: 2, spend: 2_700_000 },
  { name: 'Śląsk Forging S.A.', country: 'PL', nace: '25.50', category: 'Forgings', tier: 1, spend: 14_600_000 },
  { name: 'Hellenic Insulation ABEE', country: 'GR', nace: '23.99', category: 'Insulation', tier: 3, spend: 1_450_000 },
  { name: 'Dansk Overfladeteknik A/S', country: 'DK', nace: '25.61', category: 'Surface treatment', tier: 2, spend: 4_200_000 },
  { name: 'Carpathia Tooling SRL', country: 'RO', nace: '25.73', category: 'Tooling', tier: 3, spend: 1_900_000 },
];

/** Questionnaire responses for the three suppliers with a completed passport. */
const SEEDED_RESPONSES: Record<string, Record<string, unknown>> = {
  'Rheinstahl Walzwerke GmbH': {
    reporting_period: 'FY2025',
    employees_fte: 640,
    primary_activity: 'Hot and cold rolling of carbon steel',
    ghg_inventory_exists: true,
    scope1_tco2e: 128_400,
    scope2_method: 'market_based',
    scope2_tco2e: 41_200,
    scope3_categories_reported: ['cat1', 'cat4'],
    renewable_electricity_pct: 48,
    reduction_target: true,
    iso14001: true,
    water_withdrawal_m3: 1_240_000,
    waste_diversion_pct: 82,
    human_rights_policy: true,
    iso45001: true,
    trir: 1.9,
    code_of_conduct: true,
    anti_corruption_policy: true,
    sustainability_contact: 'Klaus Bauer, k.bauer@rheinstahl.example',
  },
  'Nordic Bearings AB': {
    reporting_period: 'FY2025',
    employees_fte: 310,
    primary_activity: 'Precision bearing manufacture',
    ghg_inventory_exists: true,
    scope1_tco2e: 4_120,
    scope2_method: 'market_based',
    scope2_tco2e: 980,
    scope3_categories_reported: ['cat1', 'cat4', 'cat6'],
    renewable_electricity_pct: 91,
    reduction_target: true,
    iso14001: true,
    waste_diversion_pct: 94,
    human_rights_policy: true,
    iso45001: true,
    trir: 0.7,
    code_of_conduct: true,
    anti_corruption_policy: true,
    sustainability_contact: 'Elin Sandberg, elin.sandberg@nordicbearings.example',
  },
  'Helvetia Sensor Systems AG': {
    reporting_period: 'FY2024',
    primary_activity: 'Industrial sensor assembly',
    ghg_inventory_exists: true,
    scope1_tco2e: 610,
    scope2_method: 'location_based',
    scope2_tco2e: 240,
    reduction_target: false,
    iso14001: false,
    human_rights_policy: true,
    code_of_conduct: true,
    anti_corruption_policy: true,
    sustainability_contact: 'Marco Frei, m.frei@helvetia-sensors.example',
  },
};

async function seedSuppliers(): Promise<void> {
  const orgId = DEMO.organizationId;
  const adminId = DEMO.users.admin.id;

  await withOrgContext(orgId, async (db) => {
    for (const row of SUPPLIER_ROWS) {
      const supplier = await db.supplier.create({
        data: {
          organizationId: orgId,
          name: row.name,
          country: row.country,
          industryNace: row.nace,
          createdByUserId: adminId,
          relationship: {
            create: {
              organizationId: orgId,
              category: row.category,
              tier: row.tier,
              annualSpend: row.spend,
              currency: 'EUR',
              since: new Date('2021-01-01'),
            },
          },
        },
      });

      const responses = SEEDED_RESPONSES[row.name];
      if (responses) {
        await db.supplierContact.create({
          data: {
            organizationId: orgId,
            supplierId: supplier.id,
            email: `sustainability@${slugFor(row.name)}.example`,
            name: 'Sustainability Team',
            isPrimary: true,
          },
        });
        await db.supplierRequest.create({
          data: {
            organizationId: orgId,
            supplierId: supplier.id,
            kind: 'sustainability_questionnaire',
            templateVersion: QUESTIONNAIRE_VERSION,
            title: 'Sustainability questionnaire',
            status: 'submitted',
            responses: responses as Prisma.InputJsonValue,
            createdByUserId: adminId,
            sentAt: new Date('2026-01-15'),
            submittedAt: new Date('2026-02-03'),
          },
        });
        await db.supplierEvidenceRef.create({
          data: {
            organizationId: orgId,
            supplierId: supplier.id,
            type: 'supplier_report',
            title: `${row.name.split(' ')[0]} Sustainability Report 2025`,
            reportingPeriod: 'FY2025',
            verified: row.name === 'Nordic Bearings AB',
            submittedByUserId: adminId,
          },
        });
        await recomputeSupplierPassport(db, {
          organizationId: orgId,
          supplierId: supplier.id,
          computedByUserId: adminId,
          requestId: 'seed',
        });
      } else if (row.tier <= 2) {
        // An open (unanswered) questionnaire for a handful of others.
        await db.supplierRequest.create({
          data: {
            organizationId: orgId,
            supplierId: supplier.id,
            kind: 'sustainability_questionnaire',
            templateVersion: QUESTIONNAIRE_VERSION,
            title: 'Sustainability questionnaire',
            status: 'sent',
            createdByUserId: adminId,
            sentAt: new Date('2026-02-20'),
          },
        });
      }
    }

    // A pending supplier-portal invitation for the top supplier.
    const top = await db.supplier.findFirst({
      where: { organizationId: orgId, name: SUPPLIER_ROWS[0]!.name },
    });
    if (top) {
      await db.invitation.create({
        data: {
          organizationId: orgId,
          email: 'portal.user@rheinstahl.example',
          roleKeys: ['supplier_user'],
          supplierId: top.id,
          invitedByUserId: adminId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });
    }

    await writeAuditLog(db, {
      organizationId: orgId,
      actorId: adminId,
      action: 'seed.suppliers_completed',
      resourceType: 'organization',
      resourceId: orgId,
      before: null,
      after: { suppliers: SUPPLIER_ROWS.length, passports: Object.keys(SEEDED_RESPONSES).length, demo: true },
      requestId: 'seed',
    });
  });
}

function slugFor(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
