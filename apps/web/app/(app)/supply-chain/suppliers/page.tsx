import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { CreateSupplier } from './suppliers-client';

export const dynamic = 'force-dynamic';

interface SupplierListItem {
  id: string;
  name: string;
  country: string;
  industryNace: string | null;
  status: string;
  category: string | null;
  tier: number | null;
  annualSpend: string | null;
  currency: string | null;
  passportCompleteness: number | null;
  openRequests: number;
}

export default async function SuppliersPage() {
  const res = await serverFetch<{ data: SupplierListItem[] }>('/suppliers?limit=100');
  const rows = res.data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Suppliers</h1>
        <CreateSupplier />
      </div>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Country</th>
              <th>Category</th>
              <th>Tier</th>
              <th>Annual spend</th>
              <th>Passport</th>
              <th>Open requests</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/supply-chain/suppliers/${s.id}`} style={{ color: 'var(--accent)' }}>
                    {s.name}
                  </Link>
                  {s.status === 'archived' && <span className="tag" style={{ marginLeft: 8 }}>archived</span>}
                </td>
                <td className="muted">{s.country}</td>
                <td className="muted">{s.category ?? '—'}</td>
                <td className="muted">{s.tier ?? '—'}</td>
                <td className="muted">
                  {s.annualSpend
                    ? `${Number(s.annualSpend).toLocaleString()} ${s.currency ?? ''}`
                    : '—'}
                </td>
                <td>{s.passportCompleteness == null ? '—' : `${s.passportCompleteness}%`}</td>
                <td>{s.openRequests || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No suppliers yet. Add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
