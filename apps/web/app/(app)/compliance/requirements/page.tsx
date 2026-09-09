import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { Disclaimer, ReadinessBar, StatusChip } from '@/components/compliance-bits';
import { ComplianceActions } from '../compliance-actions';

export const dynamic = 'force-dynamic';

interface Overview {
  loaded: boolean;
  version: string;
  knownVersions?: string[];
  regulation?: { key: string; name: string; jurisdiction: string; notice: string };
  requirements?: Array<{
    code: string;
    title: string;
    description: string;
    disclosures: Array<{
      id: string;
      code: string;
      title: string;
      requiredDatapointCount: number;
      status: string;
      satisfied: number;
      readinessPct: number;
    }>;
  }>;
  readinessPct?: number;
  lastRun?: {
    startedAt: string;
    completedAt: string | null;
    reportingPeriod: string | null;
  } | null;
}

export default async function RequirementsPage() {
  const res = await serverFetch<Overview>('/compliance/overview?version=esrs@2026.1');
  const o = res.data;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Compliance — Requirements</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {o?.regulation
              ? `${o.regulation.name} · ${o.regulation.jurisdiction} · ${o.version}`
              : 'ESRS climate (E1) rule store'}
          </p>
        </div>
        <ComplianceActions loaded={Boolean(o?.loaded)} />
      </div>

      <Disclaimer>
        {o?.regulation?.notice ??
          'TRACE supports professional judgement about disclosure readiness. It does not determine compliance and does not provide legal advice.'}
      </Disclaimer>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      {!o?.loaded ? (
        <p className="notice">
          The ESRS rule store is not loaded for this workspace yet. Load it to evaluate your data
          against ESRS E1 disclosures.
        </p>
      ) : (
        <>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <div className="label">Overall readiness</div>
              <div className="muted" style={{ fontSize: 12 }}>
                indicative — ladder progress across all required datapoints
              </div>
            </div>
            <ReadinessBar pct={o.readinessPct ?? 0} />
            {o.lastRun && (
              <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                last evaluated {new Date(o.lastRun.startedAt).toLocaleString()}
                {o.lastRun.reportingPeriod ? ` · ${o.lastRun.reportingPeriod}` : ''}
              </span>
            )}
          </div>

          {(o.requirements ?? []).map((req) => (
            <section key={req.code} className="card">
              <h2 style={{ fontSize: 15, marginTop: 0 }}>
                {req.code} — {req.title}
              </h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                {req.description}
              </p>
              <table style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Disclosure</th>
                    <th>Datapoints</th>
                    <th>Status</th>
                    <th style={{ width: 180 }}>Readiness</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {req.disclosures.map((dis) => (
                    <tr key={dis.id}>
                      <td>
                        {dis.code} — {dis.title}
                      </td>
                      <td className="muted">
                        {dis.satisfied}/{dis.requiredDatapointCount}
                      </td>
                      <td>
                        <StatusChip status={dis.status} />
                      </td>
                      <td>
                        <ReadinessBar pct={dis.readinessPct} />
                      </td>
                      <td>
                        <Link
                          href={`/compliance/disclosures/${dis.id}`}
                          style={{ color: 'var(--accent)', fontSize: 13 }}
                        >
                          why →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
