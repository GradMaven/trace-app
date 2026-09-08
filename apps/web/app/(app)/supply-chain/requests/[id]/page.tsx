import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { AcceptRequestButton } from './accept-client';

export const dynamic = 'force-dynamic';

interface Question {
  id: string;
  label: string;
  kind: string;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
}
interface Section {
  id: string;
  title: string;
  questions: Question[];
}
interface RequestDetail {
  id: string;
  supplier: { id: string; name: string };
  title: string;
  message: string | null;
  status: string;
  templateVersion: string;
  sections: Section[];
  responses: Record<string, unknown>;
  completeness: number;
  dueOn: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

function render(value: unknown, q: Question): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) {
    return value
      .map((v) => q.options?.find((o) => o.value === v)?.label ?? String(v))
      .join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (q.kind === 'single_select') return q.options?.find((o) => o.value === value)?.label ?? String(value);
  return `${String(value)}${q.unit ? ` ${q.unit}` : ''}`;
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<RequestDetail>(`/supplier-requests/${id}`);

  if (!res.ok || !res.data) {
    return (
      <div>
        <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Request not found.'}</p>
        <Link href="/supply-chain/requests" className="btn">
          Back
        </Link>
      </div>
    );
  }
  const r = res.data;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link href="/supply-chain/requests" className="muted" style={{ fontSize: 13 }}>
          ← Supplier Requests
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0' }}>{r.title}</h1>
        <span className="muted">
          {r.supplier.name} · <span className="tag">{r.status}</span> · {r.completeness}% complete ·{' '}
          template {r.templateVersion}
        </span>
      </div>

      {r.message && <p className="notice">{r.message}</p>}

      {r.status === 'submitted' && (
        <div className="card" style={{ borderColor: 'var(--attention)' }}>
          <p style={{ marginTop: 0 }}>
            Submitted {r.submittedAt ? new Date(r.submittedAt).toLocaleString() : ''}. Accepting the
            questionnaire recomputes the Supplier Passport.
          </p>
          <AcceptRequestButton requestId={r.id} supplierId={r.supplier.id} />
        </div>
      )}

      {r.sections.map((section) => (
        <section key={section.id} className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>{section.title}</h2>
          <table>
            <tbody>
              {section.questions.map((q) => (
                <tr key={q.id}>
                  <td className="muted" style={{ width: '55%' }}>
                    {q.label}
                  </td>
                  <td>{render(r.responses[q.id], q)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
