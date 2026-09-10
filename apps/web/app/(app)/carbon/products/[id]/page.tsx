import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { ProductEditor } from './product-editor';

export const dynamic = 'force-dynamic';

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
export interface PcfRecordView {
  version: number;
  methodVersion: string;
  boundary: string;
  functionalUnit: string;
  totalKgCo2e: string;
  subtotalKgCo2e: string;
  allocationMethod: string;
  allocationFactor: number;
  primaryDataSharePct: number;
  dataQualityRating: string;
  inputsDigest: string;
  computedAt: string;
  footprint: {
    subtotalKgCo2e: number;
    totalKgCo2e: number;
    primaryDataSharePct: number;
    secondaryDataSharePct: number;
    estimatedDataSharePct: number;
    dataQualityRating: string;
    unresolvedLines: number;
    warnings: string[];
    byKind: Array<{ kind: string; kgCo2e: number; sharePct: number }>;
    breakdown: Array<{
      id: string;
      label: string;
      kind: string;
      source: string;
      dataTier: string;
      quantity: number;
      unit: string;
      kgCo2ePerUnit: number | null;
      kgCo2e: number;
      sharePct: number;
      resolvedFrom: string;
      warning: string | null;
    }>;
  };
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
export interface FactorOpt {
  id: string;
  name: string;
  source: string;
  sourceRef: string;
  denominatorUnit: string;
}
export interface Named {
  id: string;
  name: string;
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detailRes, factorsRes, suppliersRes, productsRes, historyRes] = await Promise.all([
    serverFetch<ProductDetail>(`/products/${id}`),
    serverFetch<FactorOpt[]>('/emission-factors'),
    serverFetch<{ items: Named[] } | Named[]>('/suppliers'),
    serverFetch<Array<{ id: string; name: string }>>('/products'),
    serverFetch<
      Array<{
        version: number;
        totalKgCo2e: string;
        dataQualityRating: string;
        primaryDataSharePct: number;
        methodVersion: string;
        computedAt: string;
      }>
    >(`/products/${id}/pcf/history`),
  ]);

  if (!detailRes.data) {
    return (
      <p style={{ color: 'var(--critical)' }}>{detailRes.error?.message ?? 'Product not found.'}</p>
    );
  }
  const suppliers: Named[] = Array.isArray(suppliersRes.data)
    ? suppliersRes.data
    : (suppliersRes.data?.items ?? []);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <Link href="/carbon/products" className="muted" style={{ fontSize: 13 }}>
          ← Product Footprints
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0 0' }}>{detailRes.data.name}</h1>
      </div>
      <ProductEditor
        product={detailRes.data}
        factors={factorsRes.data ?? []}
        suppliers={suppliers}
        products={(productsRes.data ?? []).filter((p) => p.id !== id)}
        history={historyRes.data ?? []}
      />
    </div>
  );
}
