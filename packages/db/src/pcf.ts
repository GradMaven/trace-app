import {
  computeEmission,
  computeProductFootprint,
  pcfDataTierForMethodology,
  PCF_LINE_KINDS,
  type AllocationMethod,
  type PcfDataTier,
  type PcfLineInput,
  type PcfLineKind,
  type PcfLineSource,
  type ProductFootprint,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { writeAuditLog } from './audit';
import { supplierCarbonComparison } from './procurement';
import { type Prisma, type TenantDb } from './client';

/**
 * Product carbon footprints (Phase 14b). All rollup / allocation / data-quality
 * maths live in `@trace/domain/network/pcf` (pure); this module manages
 * products + bills of materials, resolves each BOM line to "kg CO2e per unit"
 * (reusing the Phase-4 carbon engine for unit-aware factor conversion, the
 * Phase-11 supplier comparison for spend-based lines, and a recursive PCF lookup
 * for sub-assemblies), and persists an immutable versioned `pcf_record`.
 * `db` must already be a tenant transaction.
 */

const KG_PER_TONNE = 1000;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductInput {
  name: string;
  sku?: string | null;
  description?: string | null;
  functionalUnit: string;
  referenceAmount?: number;
  referenceUnit: string;
  allocationMethod?: AllocationMethod;
  allocationFactor?: number;
  allocationNote?: string | null;
}

export interface ProductSummary {
  id: string;
  name: string;
  sku: string | null;
  functionalUnit: string;
  status: string;
  allocationMethod: string;
  allocationFactor: number;
  latestPcf: {
    version: number;
    totalKgCo2e: string;
    dataQualityRating: string;
    primaryDataSharePct: number;
    computedAt: string;
  } | null;
}

function assertAllocationFactor(f: number | undefined): number {
  const v = f ?? 1;
  if (!(v >= 0 && v <= 1)) {
    throw AppError.unprocessable('pcf.bad_allocation', 'Allocation factor must be between 0 and 1.');
  }
  return v;
}

export async function createProduct(
  db: TenantDb,
  args: { organizationId: string; input: ProductInput; actorUserId: string; requestId: string },
): Promise<{ id: string }> {
  const i = args.input;
  if (!i.name.trim()) throw AppError.unprocessable('pcf.no_name', 'A product name is required.');
  if (!i.functionalUnit.trim() || !i.referenceUnit.trim()) {
    throw AppError.unprocessable('pcf.no_unit', 'A functional unit and a reference unit are required.');
  }
  const row = await db.product.create({
    data: {
      organizationId: args.organizationId,
      name: i.name.trim(),
      sku: i.sku?.trim() || null,
      description: i.description?.trim() ?? '',
      functionalUnit: i.functionalUnit.trim(),
      referenceAmount: i.referenceAmount ?? 1,
      referenceUnit: i.referenceUnit.trim(),
      allocationMethod: i.allocationMethod ?? 'none',
      allocationFactor: assertAllocationFactor(i.allocationFactor),
      allocationNote: i.allocationNote?.trim() || null,
      createdByUserId: args.actorUserId,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'product.created',
    resourceType: 'product',
    resourceId: row.id,
    before: null,
    after: { name: row.name, functionalUnit: row.functionalUnit },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export async function updateProduct(
  db: TenantDb,
  args: {
    organizationId: string;
    id: string;
    patch: Partial<ProductInput> & { status?: string };
    actorUserId: string;
    requestId: string;
  },
): Promise<void> {
  const row = await db.product.findFirst({
    where: { id: args.id, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('pcf.product_not_found', 'Product not found.');
  const p = args.patch;
  const data: Prisma.ProductUpdateInput = {};
  if (p.name !== undefined) data.name = p.name.trim();
  if (p.sku !== undefined) data.sku = p.sku?.trim() || null;
  if (p.description !== undefined) data.description = p.description?.trim() ?? '';
  if (p.functionalUnit !== undefined) data.functionalUnit = p.functionalUnit.trim();
  if (p.referenceAmount !== undefined) data.referenceAmount = p.referenceAmount;
  if (p.referenceUnit !== undefined) data.referenceUnit = p.referenceUnit.trim();
  if (p.allocationMethod !== undefined) data.allocationMethod = p.allocationMethod;
  if (p.allocationFactor !== undefined) data.allocationFactor = assertAllocationFactor(p.allocationFactor);
  if (p.allocationNote !== undefined) data.allocationNote = p.allocationNote?.trim() || null;
  if (p.status !== undefined) data.status = p.status;

  await db.product.update({ where: { id: row.id }, data });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'product.updated',
    resourceType: 'product',
    resourceId: row.id,
    before: { name: row.name },
    after: { fields: Object.keys(data) },
    requestId: args.requestId,
  });
}

export async function archiveProduct(
  db: TenantDb,
  args: { organizationId: string; id: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.product.findFirst({
    where: { id: args.id, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('pcf.product_not_found', 'Product not found.');
  await db.product.update({
    where: { id: row.id },
    data: { status: 'archived', deletedAt: new Date() },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'product.archived',
    resourceType: 'product',
    resourceId: row.id,
    before: { status: row.status },
    after: { status: 'archived' },
    requestId: args.requestId,
  });
}

export async function listProducts(
  db: TenantDb,
  organizationId: string,
): Promise<ProductSummary[]> {
  const rows = await db.product.findMany({
    where: { organizationId, status: { not: 'archived' } },
    orderBy: { name: 'asc' },
    include: {
      pcfRecords: { orderBy: { version: 'desc' }, take: 1 },
    },
  });
  return rows.map((r) => {
    const p = r.pcfRecords[0];
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      functionalUnit: r.functionalUnit,
      status: r.status,
      allocationMethod: r.allocationMethod,
      allocationFactor: Number(r.allocationFactor),
      latestPcf: p
        ? {
            version: p.version,
            totalKgCo2e: p.totalKgCo2e.toString(),
            dataQualityRating: p.dataQualityRating,
            primaryDataSharePct: p.primaryDataSharePct,
            computedAt: p.computedAt.toISOString(),
          }
        : null,
    };
  });
}

export interface BomLineView {
  id: string;
  label: string;
  kind: string;
  quantity: string;
  unit: string;
  source: string;
  dataTier: string;
  note: string | null;
  sortOrder: number;
  emissionFactorId: string | null;
  emissionFactorLabel: string | null;
  supplierId: string | null;
  supplierName: string | null;
  subProductId: string | null;
  subProductName: string | null;
  manualKgCo2e: string | null;
}

export interface ProductDetail {
  id: string;
  name: string;
  sku: string | null;
  description: string;
  functionalUnit: string;
  referenceAmount: string;
  referenceUnit: string;
  boundary: string;
  allocationMethod: string;
  allocationFactor: number;
  allocationNote: string | null;
  status: string;
  bomLines: BomLineView[];
  latestPcf: PcfRecordView | null;
}

export async function productDetail(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<ProductDetail> {
  const row = await db.product.findFirst({
    where: { id, organizationId },
    include: {
      bomLines: {
        orderBy: { sortOrder: 'asc' },
        include: {
          emissionFactor: { select: { source: true, sourceRef: true, name: true } },
          supplier: { select: { name: true } },
          subProduct: { select: { name: true } },
        },
      },
      pcfRecords: { orderBy: { version: 'desc' }, take: 1 },
    },
  });
  if (!row) throw AppError.notFound('pcf.product_not_found', 'Product not found.');
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    description: row.description,
    functionalUnit: row.functionalUnit,
    referenceAmount: row.referenceAmount.toString(),
    referenceUnit: row.referenceUnit,
    boundary: row.boundary,
    allocationMethod: row.allocationMethod,
    allocationFactor: Number(row.allocationFactor),
    allocationNote: row.allocationNote,
    status: row.status,
    bomLines: row.bomLines.map((l) => ({
      id: l.id,
      label: l.label,
      kind: l.kind,
      quantity: l.quantity.toString(),
      unit: l.unit,
      source: l.source,
      dataTier: l.dataTier,
      note: l.note,
      sortOrder: l.sortOrder,
      emissionFactorId: l.emissionFactorId,
      emissionFactorLabel: l.emissionFactor
        ? `${l.emissionFactor.source} ${l.emissionFactor.sourceRef} — ${l.emissionFactor.name}`
        : null,
      supplierId: l.supplierId,
      supplierName: l.supplier?.name ?? null,
      subProductId: l.subProductId,
      subProductName: l.subProduct?.name ?? null,
      manualKgCo2e: l.manualKgCo2e ? l.manualKgCo2e.toString() : null,
    })),
    latestPcf: row.pcfRecords[0] ? toPcfView(row.pcfRecords[0]) : null,
  };
}

// ---------------------------------------------------------------------------
// BOM lines
// ---------------------------------------------------------------------------

export interface BomLineInput {
  label: string;
  kind: PcfLineKind;
  quantity: number;
  unit: string;
  source: PcfLineSource;
  emissionFactorId?: string | null;
  supplierId?: string | null;
  subProductId?: string | null;
  manualKgCo2e?: number | null;
  dataTier?: PcfDataTier;
  note?: string | null;
}

async function requireProduct(
  db: TenantDb,
  organizationId: string,
  productId: string,
): Promise<{ id: string }> {
  const p = await db.product.findFirst({
    where: { id: productId, organizationId },
    select: { id: true },
  });
  if (!p) throw AppError.notFound('pcf.product_not_found', 'Product not found.');
  return p;
}

async function validateLineSource(
  db: TenantDb,
  organizationId: string,
  productId: string,
  i: BomLineInput,
): Promise<void> {
  if (!PCF_LINE_KINDS.includes(i.kind)) {
    throw AppError.unprocessable('pcf.bad_kind', `Unknown BOM line kind "${i.kind}".`);
  }
  if (i.source === 'factor') {
    if (!i.emissionFactorId) {
      throw AppError.unprocessable('pcf.no_factor', 'A factor line needs an emission factor.');
    }
    const ef = await db.emissionFactor.findFirst({
      where: {
        id: i.emissionFactorId,
        OR: [{ organizationId }, { organizationId: null }],
      },
      select: { id: true },
    });
    if (!ef) throw AppError.notFound('pcf.factor_not_found', 'Emission factor not found.');
  } else if (i.source === 'supplier') {
    if (!i.supplierId) throw AppError.unprocessable('pcf.no_supplier', 'A supplier line needs a supplier.');
    const s = await db.supplier.findFirst({
      where: { id: i.supplierId, organizationId },
      select: { id: true },
    });
    if (!s) throw AppError.notFound('pcf.supplier_not_found', 'Supplier not found.');
  } else if (i.source === 'sub_product') {
    if (!i.subProductId) {
      throw AppError.unprocessable('pcf.no_sub_product', 'A sub-product line needs a product.');
    }
    if (i.subProductId === productId) {
      throw AppError.unprocessable('pcf.self_reference', 'A product cannot be its own sub-assembly.');
    }
    const sp = await db.product.findFirst({
      where: { id: i.subProductId, organizationId },
      select: { id: true },
    });
    if (!sp) throw AppError.notFound('pcf.sub_product_not_found', 'Sub-product not found.');
  } else if (i.source === 'manual') {
    if (i.manualKgCo2e == null) {
      throw AppError.unprocessable('pcf.no_manual_value', 'A manual line needs a kg CO2e value.');
    }
  }
}

export async function addBomLine(
  db: TenantDb,
  args: { organizationId: string; productId: string; input: BomLineInput; actorUserId: string; requestId: string },
): Promise<{ id: string }> {
  await requireProduct(db, args.organizationId, args.productId);
  await validateLineSource(db, args.organizationId, args.productId, args.input);
  const max = await db.bomLine.aggregate({
    where: { organizationId: args.organizationId, productId: args.productId },
    _max: { sortOrder: true },
  });
  const i = args.input;
  const row = await db.bomLine.create({
    data: {
      organizationId: args.organizationId,
      productId: args.productId,
      label: i.label.trim() || i.kind,
      kind: i.kind,
      quantity: i.quantity,
      unit: i.unit.trim(),
      source: i.source,
      emissionFactorId: i.source === 'factor' ? i.emissionFactorId : null,
      supplierId: i.source === 'supplier' ? i.supplierId : null,
      subProductId: i.source === 'sub_product' ? i.subProductId : null,
      manualKgCo2e: i.source === 'manual' ? i.manualKgCo2e : null,
      dataTier: i.dataTier ?? 'secondary',
      note: i.note?.trim() || null,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'product.bom_line_added',
    resourceType: 'bom_line',
    resourceId: row.id,
    before: null,
    after: { productId: args.productId, kind: i.kind, source: i.source },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export async function updateBomLine(
  db: TenantDb,
  args: {
    organizationId: string;
    productId: string;
    lineId: string;
    input: BomLineInput;
    actorUserId: string;
    requestId: string;
  },
): Promise<void> {
  const line = await db.bomLine.findFirst({
    where: { id: args.lineId, organizationId: args.organizationId, productId: args.productId },
  });
  if (!line) throw AppError.notFound('pcf.line_not_found', 'BOM line not found.');
  await validateLineSource(db, args.organizationId, args.productId, args.input);
  const i = args.input;
  await db.bomLine.update({
    where: { id: line.id },
    data: {
      label: i.label.trim() || i.kind,
      kind: i.kind,
      quantity: i.quantity,
      unit: i.unit.trim(),
      source: i.source,
      emissionFactorId: i.source === 'factor' ? i.emissionFactorId : null,
      supplierId: i.source === 'supplier' ? i.supplierId : null,
      subProductId: i.source === 'sub_product' ? i.subProductId : null,
      manualKgCo2e: i.source === 'manual' ? i.manualKgCo2e : null,
      dataTier: i.dataTier ?? line.dataTier,
      note: i.note?.trim() || null,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'product.bom_line_updated',
    resourceType: 'bom_line',
    resourceId: line.id,
    before: { kind: line.kind, source: line.source },
    after: { kind: i.kind, source: i.source },
    requestId: args.requestId,
  });
}

export async function deleteBomLine(
  db: TenantDb,
  args: {
    organizationId: string;
    productId: string;
    lineId: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<void> {
  const line = await db.bomLine.findFirst({
    where: { id: args.lineId, organizationId: args.organizationId, productId: args.productId },
  });
  if (!line) throw AppError.notFound('pcf.line_not_found', 'BOM line not found.');
  await db.bomLine.delete({ where: { id: line.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'product.bom_line_removed',
    resourceType: 'bom_line',
    resourceId: line.id,
    before: { label: line.label },
    after: null,
    requestId: args.requestId,
  });
}

// ---------------------------------------------------------------------------
// PCF computation
// ---------------------------------------------------------------------------

export interface PcfRecordView {
  id: string;
  productId: string;
  version: number;
  methodVersion: string;
  boundary: string;
  functionalUnit: string;
  reportingPeriod: string | null;
  totalKgCo2e: string;
  subtotalKgCo2e: string;
  allocationMethod: string;
  allocationFactor: number;
  primaryDataSharePct: number;
  dataQualityRating: string;
  inputsDigest: string;
  computedByUserId: string | null;
  computedAt: string;
  footprint: ProductFootprint;
}

function toPcfView(row: {
  id: string;
  productId: string;
  version: number;
  methodVersion: string;
  boundary: string;
  functionalUnit: string;
  reportingPeriod: string | null;
  totalKgCo2e: { toString(): string };
  subtotalKgCo2e: { toString(): string };
  allocationMethod: string;
  allocationFactor: { toString(): string };
  primaryDataSharePct: number;
  dataQualityRating: string;
  inputsDigest: string;
  computedByUserId: string | null;
  computedAt: Date;
  breakdown: unknown;
}): PcfRecordView {
  return {
    id: row.id,
    productId: row.productId,
    version: row.version,
    methodVersion: row.methodVersion,
    boundary: row.boundary,
    functionalUnit: row.functionalUnit,
    reportingPeriod: row.reportingPeriod,
    totalKgCo2e: row.totalKgCo2e.toString(),
    subtotalKgCo2e: row.subtotalKgCo2e.toString(),
    allocationMethod: row.allocationMethod,
    allocationFactor: Number(row.allocationFactor),
    primaryDataSharePct: row.primaryDataSharePct,
    dataQualityRating: row.dataQualityRating,
    inputsDigest: row.inputsDigest,
    computedByUserId: row.computedByUserId,
    computedAt: row.computedAt.toISOString(),
    footprint: row.breakdown as ProductFootprint,
  };
}

async function resolveLine(
  db: TenantDb,
  organizationId: string,
  reportingPeriod: string | undefined,
  line: {
    id: string;
    label: string;
    kind: string;
    quantity: { toString(): string };
    unit: string;
    source: string;
    dataTier: string;
    note: string | null;
    emissionFactorId: string | null;
    supplierId: string | null;
    subProductId: string | null;
    manualKgCo2e: { toString(): string } | null;
  },
  supplierIntensityById: Map<string, number | null>,
): Promise<PcfLineInput> {
  const quantity = Number(line.quantity);
  const base: Omit<PcfLineInput, 'kgCo2ePerUnit' | 'resolvedFrom' | 'dataTier'> = {
    id: line.id,
    label: line.label,
    kind: line.kind as PcfLineKind,
    source: line.source as PcfLineSource,
    quantity,
    unit: line.unit,
    note: line.note,
  };

  if (line.source === 'factor' && line.emissionFactorId) {
    const ef = await db.emissionFactor.findUnique({ where: { id: line.emissionFactorId } });
    if (!ef) {
      return { ...base, kgCo2ePerUnit: null, dataTier: 'estimated', resolvedFrom: 'factor missing' };
    }
    try {
      const r = computeEmission({
        activityValue: 1,
        activityUnit: line.unit,
        factorValue: ef.value.toString(),
        factorNumeratorUnit: ef.numeratorUnit,
        factorDenominatorUnit: ef.denominatorUnit,
        gwpSet: ef.gwpSet,
        methodology: ef.methodology ?? 'average_data',
      });
      const kgPerUnit = Number(r.resultValueTco2e) * KG_PER_TONNE;
      const tier =
        line.dataTier !== 'secondary'
          ? (line.dataTier as PcfDataTier)
          : pcfDataTierForMethodology(ef.methodology);
      return {
        ...base,
        kgCo2ePerUnit: kgPerUnit,
        dataTier: tier,
        resolvedFrom: `${ef.source} ${ef.sourceRef}`,
      };
    } catch {
      return {
        ...base,
        kgCo2ePerUnit: null,
        dataTier: 'estimated',
        resolvedFrom: `unit "${line.unit}" incompatible with factor "${ef.denominatorUnit}"`,
      };
    }
  }

  if (line.source === 'supplier' && line.supplierId) {
    const intensity = supplierIntensityById.get(line.supplierId) ?? null;
    return {
      ...base,
      kgCo2ePerUnit: intensity, // tCO2e per €1k == kg per €
      dataTier: 'estimated',
      resolvedFrom:
        intensity == null
          ? 'supplier has no carbon intensity for the period'
          : `supplier spend-based intensity (${intensity} kgCO2e/€)`,
    };
  }

  if (line.source === 'sub_product' && line.subProductId) {
    const sub = await db.pcfRecord.findFirst({
      where: { organizationId, productId: line.subProductId },
      orderBy: { version: 'desc' },
    });
    if (!sub) {
      return {
        ...base,
        kgCo2ePerUnit: null,
        dataTier: 'estimated',
        resolvedFrom: 'sub-product has no computed PCF',
      };
    }
    const tier: PcfDataTier =
      sub.dataQualityRating === 'A' || sub.dataQualityRating === 'B' ? 'primary' : 'secondary';
    return {
      ...base,
      kgCo2ePerUnit: Number(sub.totalKgCo2e),
      dataTier: tier,
      resolvedFrom: `PCF v${sub.version} (${sub.dataQualityRating})`,
    };
  }

  if (line.source === 'manual' && line.manualKgCo2e != null) {
    return {
      ...base,
      kgCo2ePerUnit: Number(line.manualKgCo2e),
      dataTier: (line.dataTier as PcfDataTier) ?? 'estimated',
      resolvedFrom: 'declared value',
    };
  }

  return { ...base, kgCo2ePerUnit: null, dataTier: 'estimated', resolvedFrom: 'unresolved' };
}

export async function computePcf(
  db: TenantDb,
  args: {
    organizationId: string;
    productId: string;
    reportingPeriod?: string;
    computedByUserId?: string | null;
    requestId: string;
  },
): Promise<PcfRecordView> {
  const product = await db.product.findFirst({
    where: { id: args.productId, organizationId: args.organizationId },
    include: { bomLines: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!product) throw AppError.notFound('pcf.product_not_found', 'Product not found.');

  // Batch the supplier-intensity lookup once.
  const supplierIds = [
    ...new Set(
      product.bomLines
        .filter((l) => l.source === 'supplier' && l.supplierId)
        .map((l) => l.supplierId as string),
    ),
  ];
  const supplierIntensityById = new Map<string, number | null>();
  if (supplierIds.length > 0) {
    const comparison = await supplierCarbonComparison(db, args.organizationId, args.reportingPeriod);
    for (const row of comparison.rows) {
      supplierIntensityById.set(row.supplierId, row.carbonIntensityPerKEur);
    }
  }

  const lines: PcfLineInput[] = [];
  for (const l of product.bomLines) {
    lines.push(await resolveLine(db, args.organizationId, args.reportingPeriod, l, supplierIntensityById));
  }

  const footprint = computeProductFootprint({
    functionalUnit: product.functionalUnit,
    boundary: product.boundary,
    allocation: {
      method: product.allocationMethod,
      factor: Number(product.allocationFactor),
      note: product.allocationNote,
    },
    lines,
  });

  const prev = await db.pcfRecord.findFirst({
    where: { organizationId: args.organizationId, productId: args.productId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });
  const row = await db.pcfRecord.create({
    data: {
      organizationId: args.organizationId,
      productId: args.productId,
      version: (prev?.version ?? 0) + 1,
      methodVersion: footprint.methodVersion,
      boundary: product.boundary,
      functionalUnit: product.functionalUnit,
      reportingPeriod: args.reportingPeriod ?? null,
      totalKgCo2e: footprint.totalKgCo2e.toFixed(6),
      subtotalKgCo2e: footprint.subtotalKgCo2e.toFixed(6),
      allocationMethod: product.allocationMethod,
      allocationFactor: product.allocationFactor,
      primaryDataSharePct: Math.round(footprint.primaryDataSharePct),
      dataQualityRating: footprint.dataQualityRating,
      breakdown: footprint as unknown as Prisma.InputJsonValue,
      inputsDigest: footprint.inputsDigest,
      supersedesId: prev?.id ?? null,
      computedByUserId: args.computedByUserId ?? null,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.computedByUserId ?? null,
    action: 'pcf.computed',
    resourceType: 'pcf_record',
    resourceId: row.id,
    before: null,
    after: {
      productId: args.productId,
      version: row.version,
      totalKgCo2e: footprint.totalKgCo2e,
      rating: footprint.dataQualityRating,
      unresolvedLines: footprint.unresolvedLines,
    },
    requestId: args.requestId,
  });

  return toPcfView(row);
}

export async function latestPcf(
  db: TenantDb,
  organizationId: string,
  productId: string,
): Promise<PcfRecordView | null> {
  const row = await db.pcfRecord.findFirst({
    where: { organizationId, productId },
    orderBy: { version: 'desc' },
  });
  return row ? toPcfView(row) : null;
}

export async function pcfByVersion(
  db: TenantDb,
  organizationId: string,
  productId: string,
  version: number,
): Promise<PcfRecordView | null> {
  const row = await db.pcfRecord.findFirst({
    where: { organizationId, productId, version },
  });
  return row ? toPcfView(row) : null;
}

export async function listPcfRecords(
  db: TenantDb,
  organizationId: string,
  productId: string,
): Promise<
  Array<{
    version: number;
    totalKgCo2e: string;
    dataQualityRating: string;
    primaryDataSharePct: number;
    methodVersion: string;
    inputsDigest: string;
    computedAt: string;
  }>
> {
  const rows = await db.pcfRecord.findMany({
    where: { organizationId, productId },
    orderBy: { version: 'desc' },
    take: 50,
  });
  return rows.map((r) => ({
    version: r.version,
    totalKgCo2e: r.totalKgCo2e.toString(),
    dataQualityRating: r.dataQualityRating,
    primaryDataSharePct: r.primaryDataSharePct,
    methodVersion: r.methodVersion,
    inputsDigest: r.inputsDigest,
    computedAt: r.computedAt.toISOString(),
  }));
}
