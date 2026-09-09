import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { Disclaimer, ReadinessBar, StatusChip } from '@/components/compliance-bits';

export const dynamic = 'force-dynamic';

interface Overview {
  loaded: boolean;
  requirements?: Array<{
    code: string;
    title: string;
    disclosures: Array<{
      id: string;
      code: string;
      title: string;
      requiredDatapointCount: number;
      satisfied: number;
      status: string;
      readinessPct: number;
    }>;
  }>;
}

export default async function DisclosuresPage() {
  const res = await serverFetch<Overview>('/compliance/overview?version=esrs@2026.1');
  const rows = (res.data?.requirements ?? []).flatMap((r) =>
    r.disclosures.map((d) => ({ ...d, requirementCode: r.code, requirementTitle: r.title })),
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Compliance — Disclosures</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Every disclosure in the loaded rule store with its objective status. Open one to trace
          requirement → datapoint → calculation → evidence.
        </p>
      </div>
      <Disclaimer />
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      {!res.data?.loaded ? (
        <p className="notice">
          Rule store not loaded. Go to{' '}
          <Link href="/compliance/requirements" style={{ color: 'var(--accent)' }}>
            Requirements
          </Link>{' '}
          to load it.
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Disclosure</th>
                <th>Datapoints</th>
                <th>Status</th>
                <th style={{ width: 180 }}>Readiness</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="muted">{d.requirementCode}</td>
                  <td>
                    {d.code} — {d.title}
                  </td>
                  <td className="muted">
                    {d.satisfied}/{d.requiredDatapointCount}
                  </td>
                  <td>
                    <StatusChip status={d.status} />
                  </td>
                  <td>
                    <ReadinessBar pct={d.readinessPct} />
                  </td>
                  <td>
                    <Link
                      href={`/compliance/disclosures/${d.id}`}
                      style={{ color: 'var(--accent)', fontSize: 13 }}
                    >
                      why →
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No disclosures.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
