import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { ReproduceButton } from './reproduce-client';

export const dynamic = 'force-dynamic';

interface Lineage {
  calculation: {
    id: string;
    scope: string;
    ghgCategory: string | null;
    methodology: string;
    reportingPeriod: string;
    resultValueTco2e: string;
    calculationVersion: string;
    calculatedAt: string;
    approvedAt: string | null;
    gwpSet: string;
    inputs: {
      inputValue: string;
      inputUnit: string;
      normalizedValue: string;
      normalizedUnit: string;
      factorValue: string;
      factorNumeratorUnit: string;
      factorDenominatorUnit: string;
      factorSource: string;
      factorVersion: number;
    };
    steps: string[];
    assumptions: Record<string, unknown>;
    factorSelectionReasons: string[];
  };
  activity: {
    id: string;
    category: string;
    description: string | null;
    value: string;
    unit: string;
    provenance: string;
    subjectType: string;
    subjectId: string;
    evidence: Array<{ id: string; title: string; type: string; status: string; reportingPeriod: string | null }>;
  };
  emissionFactor: {
    id: string;
    scopeSet: string;
    source: string;
    sourceRef: string;
    name: string;
    value: string;
    unit: string;
    gwpSet: string;
    geography: string | null;
    methodology: string | null;
    version: number;
    validFrom: string;
    validTo: string | null;
    notes: string | null;
  };
  versionChain: {
    supersedes: { id: string; resultValueTco2e: string } | null;
    supersededBy: Array<{ id: string; resultValueTco2e: string }>;
  };
  producedDatapoints: Array<{ id: string; metricKey: string }>;
}

function Node({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="label" style={{ paddingTop: 2 }}>
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default async function LineagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<Lineage>(`/calculations/${id}/lineage`);
  if (!res.ok || !res.data) {
    return <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Calculation not found.'}</p>;
  }
  const { calculation: c, activity: a, emissionFactor: f, versionChain, producedDatapoints } = res.data;
  const current = versionChain.supersededBy.length === 0;

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 820 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Calculation lineage</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Where this number comes from, exactly. Every input is stored; the result is
          reproducible from the row alone.
        </p>
      </div>

      <div className="card">
        <div style={{ fontSize: 30, fontWeight: 600 }}>
          {Number(c.resultValueTco2e).toLocaleString()} <span style={{ fontSize: 16 }}>tCO2e</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="tag">{c.scope.replace(/_/g, ' ')}</span>
          {c.ghgCategory && <span className="tag">{c.ghgCategory}</span>}
          <span className="tag">method: {c.methodology.replace(/_/g, ' ')}</span>
          <span className="tag">{c.reportingPeriod}</span>
          <span className="tag">{c.gwpSet}</span>
          <span className="mono tag">{c.calculationVersion}</span>
          {!current && <span className="tag" style={{ color: 'var(--critical)' }}>superseded</span>}
          {c.approvedAt && <span className="tag" style={{ color: 'var(--positive)' }}>approved</span>}
        </div>
        <div style={{ marginTop: 12 }}>
          <ReproduceButton calculationId={c.id} />
        </div>
      </div>

      <section className="card" style={{ display: 'grid', gap: 16 }}>
        <Node label="Activity">
          <Link href={`/data/activity/${a.id}`} style={{ color: 'var(--accent)' }}>
            {a.category}
          </Link>
          <div className="muted" style={{ fontSize: 13 }}>
            {Number(a.value).toLocaleString()} {a.unit} · provenance{' '}
            <span className="tag">{a.provenance.replace(/_/g, ' ')}</span> · subject {a.subjectType}
          </div>
        </Node>

        <Node label="Evidence">
          {a.evidence.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {a.evidence.map((e) => (
                <li key={e.id}>
                  <Link href={`/data/evidence/${e.id}`} style={{ color: 'var(--accent)' }}>
                    {e.title}
                  </Link>{' '}
                  <span className="muted">
                    — {e.type.replace(/_/g, ' ')} · <span className="tag">{e.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">None linked — this calculation is not yet defensible.</span>
          )}
        </Node>

        <Node label="Emission factor">
          <Link href="/carbon/factors" style={{ color: 'var(--accent)' }}>
            {f.name}
          </Link>
          <div className="muted" style={{ fontSize: 13 }}>
            {f.value} {f.unit} · {f.scopeSet} · {f.source}:{f.sourceRef} v{f.version} ·{' '}
            {f.geography ?? 'generic'} · valid {f.validFrom}
            {f.validTo ? `–${f.validTo}` : ' onward'}
          </div>
          {f.notes && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {f.notes}
            </div>
          )}
        </Node>

        <Node label="Factor choice">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.factorSelectionReasons.map((r, i) => (
              <li key={i} className="muted">
                {r}
              </li>
            ))}
          </ul>
        </Node>

        <Node label="Computation">
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {c.steps.map((s, i) => (
              <li key={i} className="mono" style={{ fontSize: 12 }}>
                {s}
              </li>
            ))}
          </ol>
        </Node>

        {Object.keys(c.assumptions).length > 0 && (
          <Node label="Assumptions">
            <pre className="mono" style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(c.assumptions, null, 2)}
            </pre>
          </Node>
        )}

        <Node label="Produces">
          {producedDatapoints.map((d) => (
            <Link key={d.id} href={`/data/datapoints/${d.id}`} style={{ color: 'var(--accent)' }}>
              {d.metricKey}
            </Link>
          ))}
        </Node>

        {(versionChain.supersedes || versionChain.supersededBy.length > 0) && (
          <Node label="Versions">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {versionChain.supersedes && (
                <li>
                  <Link href={`/carbon/calculations/${versionChain.supersedes.id}/lineage`} style={{ color: 'var(--accent)' }}>
                    previous
                  </Link>{' '}
                  <span className="muted">({versionChain.supersedes.resultValueTco2e} tCO2e)</span>
                </li>
              )}
              {versionChain.supersededBy.map((s) => (
                <li key={s.id}>
                  <Link href={`/carbon/calculations/${s.id}/lineage`} style={{ color: 'var(--accent)' }}>
                    newer
                  </Link>{' '}
                  <span className="muted">({s.resultValueTco2e} tCO2e)</span>
                </li>
              ))}
            </ul>
          </Node>
        )}
      </section>
    </div>
  );
}
