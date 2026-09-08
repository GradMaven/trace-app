import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  name: string;
  country: string;
  passportCompleteness: number | null;
  openRequests: number;
}

export default async function PassportsPage() {
  const res = await serverFetch<{ data: Row[] }>('/suppliers?limit=100');
  const rows = (res.data?.data ?? []).slice().sort((a, b) => {
    const av = a.passportCompleteness ?? -1;
    const bv = b.passportCompleteness ?? -1;
    return bv - av;
  });

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Supplier Passports</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        A passport is a versioned snapshot of a supplier&rsquo;s sustainability profile, assembled
        from their submitted questionnaire, the relationship record, and attached evidence. Every
        value carries its provenance.
      </p>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Country</th>
              <th>Passport completeness</th>
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
                </td>
                <td className="muted">{s.country}</td>
                <td>
                  {s.passportCompleteness == null ? (
                    <span className="muted">not computed</span>
                  ) : (
                    <CompletenessBar pct={s.passportCompleteness} />
                  )}
                </td>
                <td>{s.openRequests || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompletenessBar({ pct }: { pct: number }) {
  const color =
    pct >= 75 ? 'var(--positive)' : pct >= 40 ? 'var(--attention)' : 'var(--critical)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 120,
          height: 8,
          borderRadius: 999,
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
      <span className="muted">{pct}%</span>
    </div>
  );
}
