import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface RequestRow {
  id: string;
  supplier: { id: string; name: string };
  title: string;
  status: string;
  completeness: number;
  dueOn: string | null;
  submittedAt: string | null;
}

export default async function SupplierRequestsPage() {
  const res = await serverFetch<RequestRow[]>('/supplier-requests');
  const rows = res.data ?? [];
  const open = rows.filter((r) => ['sent', 'in_progress'].includes(r.status));
  const awaiting = rows.filter((r) => r.status === 'submitted');
  const done = rows.filter((r) => ['accepted', 'declined'].includes(r.status));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Supplier Requests</h1>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <Group title={`Awaiting your review (${awaiting.length})`} rows={awaiting} highlight />
      <Group title={`Open with suppliers (${open.length})`} rows={open} />
      <Group title={`Completed (${done.length})`} rows={done} />
    </div>
  );
}

function Group({
  title,
  rows,
  highlight,
}: {
  title: string;
  rows: RequestRow[];
  highlight?: boolean;
}) {
  return (
    <section className="card" style={highlight ? { borderColor: 'var(--attention)' } : undefined}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Request</th>
              <th>Status</th>
              <th>Completeness</th>
              <th>Due</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/supply-chain/suppliers/${r.supplier.id}`} style={{ color: 'var(--accent)' }}>
                    {r.supplier.name}
                  </Link>
                </td>
                <td>{r.title}</td>
                <td>
                  <span className="tag">{r.status}</span>
                </td>
                <td className="muted">{r.completeness}%</td>
                <td className="muted">{r.dueOn ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/supply-chain/requests/${r.id}`} style={{ color: 'var(--accent)' }}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
