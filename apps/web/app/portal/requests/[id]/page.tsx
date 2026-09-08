import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { QuestionnaireForm, type Section } from './questionnaire-form';

export const dynamic = 'force-dynamic';

interface RequestDetail {
  id: string;
  title: string;
  message: string | null;
  status: string;
  sections: Section[];
  responses: Record<string, unknown>;
  completeness: number;
  dueOn: string | null;
  submittedAt: string | null;
}

export default async function PortalRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<RequestDetail>(`/supplier-portal/requests/${id}`);

  if (!res.ok || !res.data) {
    return (
      <div>
        <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Request not found.'}</p>
        <Link href="/portal" className="btn">
          Back
        </Link>
      </div>
    );
  }
  const r = res.data;
  const locked = r.status === 'submitted' || r.status === 'accepted';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <Link href="/portal" className="muted" style={{ fontSize: 13 }}>
          ← Overview
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0' }}>{r.title}</h1>
        <span className="muted">
          <span className="tag">{r.status}</span>
          {r.dueOn ? ` · due ${r.dueOn}` : ''}
        </span>
      </div>
      {r.message && <p className="notice">{r.message}</p>}

      {locked ? (
        <p className="notice">
          This questionnaire was submitted
          {r.submittedAt ? ` on ${new Date(r.submittedAt).toLocaleDateString()}` : ''} and can no
          longer be edited.
        </p>
      ) : null}

      <QuestionnaireForm
        requestId={r.id}
        sections={r.sections}
        initialResponses={r.responses}
        locked={locked}
      />
    </div>
  );
}
