import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { NewProductForm } from './new-product-form';

export const dynamic = 'force-dynamic';

interface ProductSummary {
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

const RATING_COLOR: Record<string, string> = {
  A: 'var(--positive)',
  B: 'var(--positive)',
  C: 'var(--attention, orange)',
  D: 'var(--critical)',
  E: 'var(--critical)',
};

export default async function ProductsPage() {
  const res = await serverFetch<ProductSummary[]>('/products');
  const products = res.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Carbon — Product Footprints</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Cradle-to-gate product carbon footprints (PCF): a bill of materials, each line resolved
          to kg CO2e per unit from an emission factor, a supplier&apos;s carbon intensity, another
          product&apos;s PCF, or a declared value; rolled up per functional unit with an
          allocation factor and graded A–E by primary-data share. Records are immutable and
          versioned.
        </p>
      </div>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <NewProductForm />

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Functional unit</th>
              <th style={{ textAlign: 'right' }}>Footprint</th>
              <th>Rating</th>
              <th style={{ textAlign: 'right' }}>Primary data</th>
              <th>Allocation</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 16 }}>
                  No products yet.
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/carbon/products/${p.id}`} style={{ color: 'var(--accent)' }}>
                    {p.name}
                  </Link>
                  {p.sku && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {p.sku}
                    </div>
                  )}
                </td>
                <td className="muted">{p.functionalUnit}</td>
                <td style={{ textAlign: 'right' }}>
                  {p.latestPcf ? (
                    <strong>
                      {Number(p.latestPcf.totalKgCo2e).toLocaleString('en-US', {
                        maximumFractionDigits: 2,
                      })}{' '}
                      kg
                    </strong>
                  ) : (
                    <span className="muted">not computed</span>
                  )}
                </td>
                <td>
                  {p.latestPcf ? (
                    <span
                      className="tag"
                      style={{
                        color: RATING_COLOR[p.latestPcf.dataQualityRating],
                        borderColor: RATING_COLOR[p.latestPcf.dataQualityRating],
                      }}
                    >
                      {p.latestPcf.dataQualityRating}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ textAlign: 'right' }} className="muted">
                  {p.latestPcf ? `${p.latestPcf.primaryDataSharePct}%` : '—'}
                </td>
                <td className="muted">
                  {p.allocationMethod}
                  {p.allocationFactor !== 1 ? ` · ${p.allocationFactor}` : ''}
                </td>
                <td style={{ textAlign: 'right' }} className="muted">
                  {p.latestPcf ? `v${p.latestPcf.version}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
