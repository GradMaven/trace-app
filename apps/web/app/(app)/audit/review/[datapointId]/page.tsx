import type { ReactNode } from 'react';
import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Chain {
  datapoint: {
    id: string;
    metricKey: string;
    value: string | null;
    unit: string | null;
    provenance: string;
    label: string;
    reportingPeriod: string | null;
    subjectType: string;
    subjectId: string;
    createdAt: string;
  };
  trust: { value: number; band: string; modelVersion: string } | null;
  calculation: {
    id: string;
    scope: string;
    methodology: string;
    inputValue: string;
    inputUnit: string;
    factorValue: string;
    factorSource: string;
    factorVersion: number;
    gwpSet: string;
    resultValueTco2e: string;
    steps: string[];
    factorSelectionReasons: string[];
    approvedByUserId: string | null;
    approvedAt: string | null;
    reproduce: {
      reproduced: boolean;
      storedResult: string;
      recomputedResult: string;
      steps: string[];
    } | null;
    activity: {
      id: string;
      category: string;
      value: string;
      unit: string;
      provenance: string;
      occurredOn: string | null;
    } | null;
    emissionFactor: {
      source: string;
      sourceRef: string;
      name: string;
      value: string;
      gwpSet: string;
      validFrom: string;
      validTo: string | null;
    };
  } | null;
  evidence: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    issuer: string | null;
    reportingPeriod: string | null;
    hash: string;
    expiresAt: string | null;
    hasDocument: boolean;
    verifications: Array<{
      method: string;
      outcome: string;
      verifiedAt: string;
      notes: string | null;
    }>;
  }>;
  complianceMappings: Array<{
    requiredDatapointKey: string;
    label: string;
    disclosureCode: string;
    status: string;
    confirmed: boolean;
  }>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13, padding: '2px 0' }}>
      <span className="muted" style={{ minWidth: 150 }}>
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

export default async function ChainPage({ params }: { params: Promise<{ datapointId: string }> }) {
  const { datapointId } = await params;
  const res = await serverFetch<Chain>(`/audit/evidence-chain/${datapointId}`);
  if (!res.ok || !res.data) {
    return <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Not found.'}</p>;
  }
  const c = res.data;

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
      <div>
        <Link href="/audit/review" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Evidence Review
        </Link>
        <h1 style={{ fontSize: 20, margin: '6px 0 0' }}>Evidence chain</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Walk this number from disclosure back to the source, without engineering help.
        </p>
      </div>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>1 · Datapoint</h2>
        <div style={{ fontSize: 24, fontWeight: 600 }}>
          {c.datapoint.value ?? '—'}
          {c.datapoint.unit ? (
            <span style={{ fontSize: 15, fontWeight: 400 }}> {c.datapoint.unit}</span>
          ) : null}
        </div>
        <div className="mono muted">{c.datapoint.metricKey}</div>
        <Row label="provenance">{c.datapoint.provenance.replace(/_/g, ' ')}</Row>
        <Row label="label">{c.datapoint.label.replace(/_/g, ' ')}</Row>
        <Row label="period">{c.datapoint.reportingPeriod ?? '—'}</Row>
        <Row label="subject">
          {c.datapoint.subjectType} · {c.datapoint.subjectId.slice(0, 8)}
        </Row>
        <Row label="trust score">
          {c.trust ? (
            <Link href={`/data/datapoints/${c.datapoint.id}`} style={{ color: 'var(--accent)' }}>
              {c.trust.value}/100 ({c.trust.band}) · {c.trust.modelVersion}
            </Link>
          ) : (
            'not scored'
          )}
        </Row>
      </section>

      {c.calculation && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>2 · Calculation</h2>
          <Row label="scope / methodology">
            {c.calculation.scope} · {c.calculation.methodology.replace(/_/g, ' ')}
          </Row>
          <Row label="result">{c.calculation.resultValueTco2e} tCO2e</Row>
          <Row label="reproduces?">
            {c.calculation.reproduce ? (
              <span
                style={{
                  color: c.calculation.reproduce.reproduced ? 'var(--positive)' : 'var(--critical)',
                }}
              >
                {c.calculation.reproduce.reproduced
                  ? 'yes — bit-for-bit'
                  : 'NO — stored ≠ recomputed'}{' '}
                ({c.calculation.reproduce.recomputedResult})
              </span>
            ) : (
              '—'
            )}
          </Row>
          <Row label="approved">
            {c.calculation.approvedByUserId
              ? `yes · ${c.calculation.approvedAt ? new Date(c.calculation.approvedAt).toLocaleDateString() : ''}`
              : 'no'}
          </Row>
          <Row label="steps">
            <span className="mono" style={{ fontSize: 12 }}>
              {c.calculation.steps.join('  →  ')}
            </span>
          </Row>
          <Row label="factor selection">
            <span className="muted" style={{ fontSize: 12 }}>
              {c.calculation.factorSelectionReasons.join('; ')}
            </span>
          </Row>
          <Link
            href={`/data/calculations/${c.calculation.id}`}
            style={{ color: 'var(--accent)', fontSize: 13 }}
          >
            full lineage →
          </Link>
        </section>
      )}

      {c.calculation?.activity && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>3 · Activity data</h2>
          <Row label="category">{c.calculation.activity.category}</Row>
          <Row label="quantity">
            {c.calculation.activity.value} {c.calculation.activity.unit}
          </Row>
          <Row label="provenance">{c.calculation.activity.provenance.replace(/_/g, ' ')}</Row>
          <Row label="occurred on">{c.calculation.activity.occurredOn ?? '—'}</Row>
        </section>
      )}

      {c.calculation && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>4 · Emission factor</h2>
          <Row label="source">
            {c.calculation.emissionFactor.source}:{c.calculation.emissionFactor.sourceRef} (v
            {c.calculation.factorVersion})
          </Row>
          <Row label="name">{c.calculation.emissionFactor.name}</Row>
          <Row label="value">
            {c.calculation.emissionFactor.value} · GWP {c.calculation.emissionFactor.gwpSet}
          </Row>
          <Row label="validity">
            {c.calculation.emissionFactor.validFrom} →{' '}
            {c.calculation.emissionFactor.validTo ?? 'open'}
          </Row>
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>{c.calculation ? '5' : '2'} · Evidence</h2>
        {c.evidence.length === 0 ? (
          <p className="notice">No evidence linked — this datapoint is not defensible.</p>
        ) : (
          c.evidence.map((e) => (
            <div
              key={e.id}
              style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginTop: 8 }}
            >
              <div>
                <Link href={`/data/evidence/${e.id}`} style={{ color: 'var(--accent)' }}>
                  {e.title}
                </Link>{' '}
                <span className="muted">
                  — {e.type.replace(/_/g, ' ')} · <span className="tag">{e.status}</span>
                  {e.issuer ? ` · ${e.issuer}` : ''}
                  {e.hasDocument ? ' · has document' : ''}
                  {e.expiresAt ? ` · expires ${e.expiresAt}` : ''}
                </span>
              </div>
              <div className="mono muted" style={{ fontSize: 11 }}>
                hash {e.hash.slice(0, 24)}
              </div>
              {e.verifications.map((v, i) => (
                <div key={i} className="muted" style={{ fontSize: 12 }}>
                  verified {v.method} — {v.outcome} · {new Date(v.verifiedAt).toLocaleDateString()}
                  {v.notes ? ` — ${v.notes}` : ''}
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      {c.complianceMappings.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Feeds these disclosures</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.complianceMappings.map((m) => (
              <li key={m.requiredDatapointKey}>
                {m.disclosureCode} — {m.label}{' '}
                <span className="tag">{m.status.replace(/_/g, ' ')}</span>
                {m.confirmed ? ' · confirmed' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
