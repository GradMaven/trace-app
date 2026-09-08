import { serverFetch } from '@/lib/server-api';
import { EvidenceClient } from './evidence-client';

export const dynamic = 'force-dynamic';

interface EvidenceRow {
  id: string;
  type: string;
  title: string;
  sourceUrl: string | null;
  note: string | null;
  reportingPeriod: string | null;
  verified: boolean;
  createdAt: string;
}

export default async function PortalEvidencePage() {
  const res = await serverFetch<EvidenceRow[]>('/supplier-portal/evidence');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Evidence</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Share links to reports, certificates, and datasets that support your answers. Your
          customer reviews and verifies them. Document upload arrives in a later release.
        </p>
      </div>
      <EvidenceClient existing={res.data ?? []} error={res.error?.message ?? null} />
    </div>
  );
}
