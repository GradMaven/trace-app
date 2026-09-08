import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Overview {
  supplier: { id: string; name: string; country: string; industryNace: string | null };
  relationship: { category: string | null; tier: number | null } | null;
  openRequests: number;
  evidenceCount: number;
  passport: { version: number; completeness: number; computedAt: string } | null;
}
interface RequestRow {
  id: string;
  title: string;
  status: string;
  completeness: number;
  dueOn: string | null;
  submittedAt: string | null;
}

export default async function PortalOverview() {
  const [ov, reqs] = await Promise.all([
    serverFetch<Overview>('/supplier-portal'),
    serverFetch<RequestRow[]>('/supplier-portal/requests'),
  ]);
  const o = ov.data;
  const requests = reqs.data ?? [];
  const openRequests = requests.filter((r) => ['sent', 'in_progress'].includes(r.status));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Welcome{o ? `, ${o.supplier.name}` : ''}</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Respond to sustainability requests and share evidence with your customer.
        </p>
      </div>

      {ov.error && <p style={{ color: 'var(--critical)' }}>{ov.error.message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
        <Stat label="Open requests" value={String(o?.openRequests ?? 0)} />
        <Stat label="Evidence shared" value={String(o?.evidenceCount ?? 0)} />
        <Stat
          label="Passport completeness"
          value={o?.passport ? `${o.passport.completeness}%` : '—'}
        />
      </div>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Requests</h2>
        {requests.length === 0 ? (
          <p className="muted">No requests yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Status</th>
                <th>Completeness</th>
                <th>Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>
                    <span className="tag">{r.status}</span>
                  </td>
                  <td className="muted">{r.completeness}%</td>
                  <td className="muted">{r.dueOn ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {['sent', 'in_progress'].includes(r.status) ? (
                      <Link href={`/portal/requests/${r.id}`} className="btn btn-primary">
                        Respond
                      </Link>
                    ) : (
                      <Link href={`/portal/requests/${r.id}`} style={{ color: 'var(--accent)' }}>
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {openRequests.length === 0 && requests.length > 0 && (
        <p className="notice">All requests are up to date. Thank you.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
