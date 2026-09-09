import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { Disclaimer, GapReasons, ReadinessBar, StatusChip } from '@/components/compliance-bits';
import { ConfirmMapping } from './confirm-mapping';

export const dynamic = 'force-dynamic';

interface Mapping {
  id?: string;
  status: string;
  gapReasons: string[];
  datapointIds?: string[];
  calculationIds?: string[];
  evidenceIds?: string[];
  resolvedValue?: string | null;
  resolvedValueText?: string | null;
  trustScore?: number | null;
  confirmed: boolean;
  confirmedAt?: string | null;
  note?: string | null;
}

interface DisclosureDetail {
  id: string;
  code: string;
  title: string;
  guidance: string;
  ruleStoreVersion: string;
  notice: string;
  requirement: { code: string; title: string };
  status: string;
  readinessPct: number;
  requiredDatapoints: Array<{
    key: string;
    label: string;
    metricKey: string;
    unit: string | null;
    cardinality: string;
    subjectScope: string;
    mapping: Mapping;
  }>;
  evidenceRequirements: Array<{ key: string; description: string; acceptableTypes: string[] }>;
  controls: Array<{
    id: string;
    key: string;
    name: string;
    status: string;
    owner: string | null;
    lastTestedAt: string | null;
  }>;
}

export default async function DisclosurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<DisclosureDetail>(`/compliance/disclosures/${id}`);
  if (!res.ok || !res.data) {
    return (
      <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Disclosure not found.'}</p>
    );
  }
  const d = res.data;

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 900 }}>
      <div>
        <Link href="/compliance/requirements" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Requirements
        </Link>
        <h1 style={{ fontSize: 20, margin: '6px 0 0' }}>
          {d.code} — {d.title}
        </h1>
        <p className="muted" style={{ marginTop: 4 }}>
          {d.requirement.code} · {d.ruleStoreVersion}
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <StatusChip status={d.status} />
          <ReadinessBar pct={d.readinessPct} />
        </div>
      </div>

      <Disclaimer>{d.notice}</Disclaimer>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Guidance</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {d.guidance}
        </p>
      </section>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Required datapoint</th>
              <th>Resolved value</th>
              <th>Company data</th>
              <th>Trust</th>
              <th>Status</th>
              <th>Gaps</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.requiredDatapoints.map((rd) => {
              const m = rd.mapping;
              return (
                <tr key={rd.key}>
                  <td>
                    <div>{rd.label}</div>
                    <div className="mono muted" style={{ fontSize: 11 }}>
                      {rd.metricKey}
                      {rd.unit ? ` · ${rd.unit}` : ''} · {rd.subjectScope}
                    </div>
                  </td>
                  <td className="mono">{m.resolvedValue ?? m.resolvedValueText ?? '—'}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {(m.datapointIds ?? []).length > 0
                      ? (m.datapointIds ?? []).map((dpId, i) => (
                          <span key={dpId}>
                            {i > 0 ? ', ' : ''}
                            <Link
                              href={`/data/datapoints/${dpId}`}
                              style={{ color: 'var(--accent)' }}
                            >
                              datapoint {i + 1}
                            </Link>
                          </span>
                        ))
                      : '—'}
                    {(m.evidenceIds ?? []).length > 0 && (
                      <div>{(m.evidenceIds ?? []).length} live evidence</div>
                    )}
                  </td>
                  <td>{m.trustScore ?? '—'}</td>
                  <td>
                    <StatusChip status={m.status} />
                  </td>
                  <td>
                    <GapReasons reasons={m.gapReasons} />
                  </td>
                  <td>
                    {m.id &&
                    (m.status === 'evidence_available' ||
                      m.status === 'mapping_complete' ||
                      m.confirmed) ? (
                      <ConfirmMapping mappingId={m.id} confirmed={m.confirmed} />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Evidence requirements</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          {d.evidenceRequirements.map((e) => (
            <li key={e.key}>
              {e.description}{' '}
              <span className="muted" style={{ fontSize: 12 }}>
                — accepts: {e.acceptableTypes.map((t) => t.replace(/_/g, ' ')).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Controls</h2>
        {d.controls.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No controls recorded for this requirement yet.
          </p>
        ) : (
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Control</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Last tested</th>
              </tr>
            </thead>
            <tbody>
              {d.controls.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted">{c.owner ?? '—'}</td>
                  <td>
                    <span className="tag">{c.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="muted">
                    {c.lastTestedAt ? new Date(c.lastTestedAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
