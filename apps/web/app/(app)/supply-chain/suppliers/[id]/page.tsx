import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { SupplierActions } from './supplier-detail-client';
import { PassportView } from './passport-view';

export const dynamic = 'force-dynamic';

interface SupplierDetail {
  id: string;
  name: string;
  country: string;
  industryNace: string | null;
  status: string;
  relationship: {
    category: string | null;
    tier: number | null;
    annualSpend: string | null;
    currency: string | null;
    since: string | null;
  } | null;
  contacts: Array<{ id: string; email: string; name: string; role: string | null; isPrimary: boolean }>;
  locations: Array<{ id: string; kind: string; label: string; country: string }>;
  requests: Array<{
    id: string;
    title: string;
    status: string;
    dueOn: string | null;
    sentAt: string | null;
    submittedAt: string | null;
  }>;
  evidence: Array<{
    id: string;
    type: string;
    title: string;
    sourceUrl: string | null;
    reportingPeriod: string | null;
    verified: boolean;
  }>;
  passport: { version: number; completeness: number; computedAt: string; data: unknown } | null;
}

interface Invitation {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
}

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detailRes, invitesRes] = await Promise.all([
    serverFetch<SupplierDetail>(`/suppliers/${id}`),
    serverFetch<Invitation[]>(`/suppliers/${id}/invitations`),
  ]);

  if (!detailRes.ok || !detailRes.data) {
    return (
      <div>
        <p style={{ color: 'var(--critical)' }}>
          {detailRes.error?.message ?? 'Supplier not found.'}
        </p>
        <Link href="/supply-chain/suppliers" className="btn">
          Back to suppliers
        </Link>
      </div>
    );
  }
  const s = detailRes.data;
  const pendingInvites = (invitesRes.data ?? []).filter((i) => i.status === 'pending');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Link href="/supply-chain/suppliers" className="muted" style={{ fontSize: 13 }}>
            ← Suppliers
          </Link>
          <h1 style={{ fontSize: 22, margin: '4px 0' }}>{s.name}</h1>
          <span className="muted">
            {s.country}
            {s.industryNace ? ` · NACE ${s.industryNace}` : ''} · {s.status}
          </span>
        </div>
      </div>

      <SupplierActions
        supplierId={s.id}
        hasRelationship={!!s.relationship}
        hasOpenRequest={s.requests.some((r) => ['draft', 'sent', 'in_progress'].includes(r.status))}
        submittedRequestId={s.requests.find((r) => r.status === 'submitted')?.id ?? null}
        relationship={s.relationship}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Relationship</h2>
          {s.relationship ? (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
              <dt className="muted">Category</dt>
              <dd style={{ margin: 0 }}>{s.relationship.category ?? '—'}</dd>
              <dt className="muted">Tier</dt>
              <dd style={{ margin: 0 }}>{s.relationship.tier ?? '—'}</dd>
              <dt className="muted">Annual spend</dt>
              <dd style={{ margin: 0 }}>
                {s.relationship.annualSpend
                  ? `${Number(s.relationship.annualSpend).toLocaleString()} ${s.relationship.currency}`
                  : '—'}
              </dd>
            </dl>
          ) : (
            <p className="muted">No relationship record yet.</p>
          )}
        </section>

        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Portal access</h2>
          {pendingInvites.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {pendingInvites.map((i) => (
                <li key={i.id} className="muted">
                  {i.email} — invited, expires {new Date(i.expiresAt).toLocaleDateString()}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No pending supplier-user invitations.</p>
          )}
        </section>
      </div>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Contacts</h2>
        {s.contacts.length > 0 ? (
          <table>
            <tbody>
              {s.contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted">{c.email}</td>
                  <td className="muted">{c.role ?? ''}</td>
                  <td>{c.isPrimary && <span className="tag">primary</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No contacts.</p>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Information requests</h2>
        {s.requests.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Due</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>
                    <span className="tag">{r.status}</span>
                  </td>
                  <td className="muted">{r.dueOn ?? '—'}</td>
                  <td className="muted">
                    {r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/supply-chain/requests/${r.id}`} style={{ color: 'var(--accent)' }}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No requests sent yet.</p>
        )}
      </section>

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Supplier Passport</h2>
          {s.passport && (
            <span className="muted" style={{ fontSize: 13 }}>
              v{s.passport.version} · {s.passport.completeness}% complete ·{' '}
              {new Date(s.passport.computedAt).toLocaleString()}
            </span>
          )}
        </div>
        {s.passport ? (
          <PassportView data={s.passport.data} />
        ) : (
          <p className="muted">
            No passport yet. It is computed when the supplier submits a questionnaire, or via
            &ldquo;Recompute passport&rdquo; above.
          </p>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Evidence</h2>
        {s.evidence.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Period</th>
                <th>Verified</th>
              </tr>
            </thead>
            <tbody>
              {s.evidence.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.sourceUrl ? (
                      <a href={e.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                        {e.title}
                      </a>
                    ) : (
                      e.title
                    )}
                  </td>
                  <td className="muted">{e.type}</td>
                  <td className="muted">{e.reportingPeriod ?? '—'}</td>
                  <td>{e.verified ? <span className="tag">verified</span> : <span className="muted">no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">
            No evidence yet. Suppliers attach evidence references from their portal (Phase 3 links
            these to stored documents).
          </p>
        )}
      </section>
    </div>
  );
}
