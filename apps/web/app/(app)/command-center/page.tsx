import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { Gauge, Sparkline, StackBar, bandFor } from '@/components/dashboard-bits';
import { RecomputeInventoryButton } from './recompute-client';

export const dynamic = 'force-dynamic';

interface Overview {
  organization: { legalName: string; country: string };
  reportingPeriod: string;
  ruleStoreVersion: string;
  emissions: {
    scope1: string;
    scope2Reported: string;
    scope3: string;
    total: string;
    byScope3Category: Array<{ ghgCategory: string | null; valueTco2e: string; count: number }>;
  };
  emissionsTrend: Array<{
    reportingPeriod: string;
    total: string;
    scope1: string;
    scope2Reported: string;
    scope3: string;
  }>;
  provenance: {
    total: number;
    byProvenance: Array<{ provenance: string; count: number }>;
    byLabel: Array<{ label: string; count: number }>;
    primarySharePct: number;
  };
  trust: {
    scored: number;
    datapoints: number;
    avgTrustScore: number | null;
    bands: { high: number; medium: number; low: number };
    openIssues: { critical: number; warning: number; info: number; total: number };
    openAnomalies: number;
  };
  audit: {
    readinessValue: number | null;
    readinessBand: string | null;
    openFindings: { critical: number; warning: number; info: number; total: number };
    topFindings: Array<{
      id: string;
      severity: string;
      kind: string | null;
      title: string;
      subjectType: string;
      subjectId: string;
    }>;
  };
  compliance: {
    ruleStoreLoaded: boolean;
    readinessPct: number;
    disclosures: { total: number; byStatus: Record<string, number> };
    topGaps: Array<{
      disclosureId: string;
      disclosureCode: string;
      requiredDatapointKey: string;
      label: string;
      status: string;
      gapReasons: string[];
    }>;
  };
  suppliers: {
    active: number;
    withPassport: number;
    withSubmittedQuestionnaire: number;
    coveragePct: number;
  };
  recentActivity: Array<{ id: string; action: string; createdAt: string }>;
}

const num = (v: string | undefined) => (v == null ? '—' : Number(v).toLocaleString());

const PROV_COLOR: Record<string, string> = {
  measured: 'var(--positive)',
  supplier_reported: '#5b9bd5',
  calculated: 'var(--accent)',
  estimated: 'var(--attention)',
  modeled: '#b98',
  inferred: 'var(--critical)',
};
const SEV_COLOR: Record<string, string | undefined> = {
  critical: 'var(--critical)',
  warning: 'var(--attention)',
  info: undefined,
};

export default async function CommandCenterPage() {
  const res = await serverFetch<Overview>('/command-center/overview');
  if (!res.ok || !res.data) {
    return <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Failed to load.'}</p>;
  }
  const o = res.data;
  const trend = o.emissionsTrend;
  const scope3 = [...o.emissions.byScope3Category].sort(
    (a, b) => Number(b.valueTco2e) - Number(a.valueTco2e),
  );

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
          <h1 style={{ fontSize: 20, margin: 0 }}>Command Center</h1>
          <p className="muted" style={{ marginTop: 2 }}>
            {o.organization.legalName} · {o.organization.country} · {o.reportingPeriod} · every
            figure below is read straight from the model — nothing is estimated for display.
          </p>
        </div>
        <RecomputeInventoryButton period={o.reportingPeriod} />
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Gauge
          label="Audit readiness"
          value={o.audit.readinessValue}
          band={o.audit.readinessBand ?? undefined}
          href="/audit/readiness"
        />
        <Gauge label="Avg Trust Score" value={o.trust.avgTrustScore} href="/data/quality" />
        <Gauge
          label="Compliance readiness"
          value={o.compliance.readinessPct}
          suffix="%"
          href="/compliance/requirements"
        />
        <Gauge
          label="Primary-data share"
          value={o.provenance.primarySharePct}
          suffix="%"
          href="/data/evidence"
        />
        <Gauge
          label="Supplier coverage"
          value={o.suppliers.coveragePct}
          suffix="%"
          href="/supply-chain/passports"
        />
      </div>

      <section className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <h2 style={{ fontSize: 15, marginTop: 0 }}>GHG inventory — {o.reportingPeriod}</h2>
          {trend.length >= 2 && <Sparkline points={trend.map((t) => Number(t.total))} />}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 14,
          }}
        >
          <Metric label="Scope 1" value={num(o.emissions.scope1)} unit="tCO2e" />
          <Metric label="Scope 2 (reported)" value={num(o.emissions.scope2Reported)} unit="tCO2e" />
          <Metric label="Scope 3" value={num(o.emissions.scope3)} unit="tCO2e" />
          <Metric label="Total" value={num(o.emissions.total)} unit="tCO2e" strong />
        </div>
        {trend.length >= 2 && (
          <table style={{ marginTop: 12, width: '100%' }}>
            <thead>
              <tr>
                <th>Period</th>
                <th style={{ textAlign: 'right' }}>Scope 1</th>
                <th style={{ textAlign: 'right' }}>Scope 2</th>
                <th style={{ textAlign: 'right' }}>Scope 3</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((t) => (
                <tr key={t.reportingPeriod}>
                  <td>{t.reportingPeriod}</td>
                  <td style={{ textAlign: 'right' }}>{num(t.scope1)}</td>
                  <td style={{ textAlign: 'right' }}>{num(t.scope2Reported)}</td>
                  <td style={{ textAlign: 'right' }}>{num(t.scope3)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{num(t.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <section className="card" style={{ flex: '1 1 320px' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            Data provenance ({o.provenance.total} datapoints)
          </h2>
          <StackBar
            segments={o.provenance.byProvenance.map((p) => ({
              label: p.provenance.replace(/_/g, ' '),
              value: p.count,
              color: PROV_COLOR[p.provenance] ?? 'var(--text-muted)',
            }))}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            {o.provenance.primarySharePct}% is measured or supplier-reported (primary data). Label
            mix:{' '}
            {o.provenance.byLabel.map((l, i) => (
              <span key={l.label}>
                {i > 0 ? ' · ' : ''}
                {l.label.replace(/_/g, ' ')} {l.count}
              </span>
            ))}
          </p>
        </section>

        {scope3.length > 0 && (
          <section className="card" style={{ flex: '1 1 320px' }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Scope 3 by category</h2>
            <table>
              <tbody>
                {scope3.map((c) => (
                  <tr key={c.ghgCategory}>
                    <td>{c.ghgCategory?.replace(/^cat_(\d+)_/, '$1 · ').replace(/_/g, ' ')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{Number(c.valueTco2e).toLocaleString()}</strong> tCO2e
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Link href="/carbon/scope-3" style={{ color: 'var(--accent)', fontSize: 13 }}>
              Open Scope 3 →
            </Link>
          </section>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <section className="card" style={{ flex: '1 1 320px' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Trust</h2>
          <StackBar
            segments={[
              { label: 'high', value: o.trust.bands.high, color: 'var(--positive)' },
              { label: 'medium', value: o.trust.bands.medium, color: 'var(--attention)' },
              { label: 'low', value: o.trust.bands.low, color: 'var(--critical)' },
            ]}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            {o.trust.scored}/{o.trust.datapoints} datapoints scored ·{' '}
            <span style={{ color: 'var(--critical)' }}>{o.trust.openIssues.critical} critical</span>{' '}
            / {o.trust.openIssues.total} open data-quality issues · {o.trust.openAnomalies}{' '}
            anomalies.{' '}
            <Link href="/data/quality" style={{ color: 'var(--accent)' }}>
              Data Quality →
            </Link>
          </p>
        </section>

        <section className="card" style={{ flex: '1 1 320px' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Audit findings</h2>
          <p style={{ fontSize: 22, fontWeight: 600, margin: '2px 0' }}>
            {o.audit.openFindings.total} open
          </p>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            <span style={{ color: 'var(--critical)' }}>
              {o.audit.openFindings.critical} critical
            </span>{' '}
            ·{' '}
            <span style={{ color: 'var(--attention)' }}>
              {o.audit.openFindings.warning} warning
            </span>{' '}
            · {o.audit.openFindings.info} info
          </p>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {o.audit.topFindings.slice(0, 4).map((f) => (
              <li key={f.id}>
                <span className="tag" style={{ color: SEV_COLOR[f.severity] }}>
                  {f.severity}
                </span>{' '}
                {f.title}
              </li>
            ))}
          </ul>
          <Link href="/audit/findings" style={{ color: 'var(--accent)', fontSize: 13 }}>
            Triage findings →
          </Link>
        </section>
      </div>

      <section className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Compliance — {o.ruleStoreVersion}</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {o.compliance.disclosures.total} disclosures ·{' '}
            {Object.entries(o.compliance.disclosures.byStatus)
              .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
              .join(' · ')}
          </span>
        </div>
        {!o.compliance.ruleStoreLoaded ? (
          <p className="notice">
            The ESRS rule store is not loaded.{' '}
            <Link href="/compliance/requirements" style={{ color: 'var(--accent)' }}>
              Load it →
            </Link>
          </p>
        ) : (
          <>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--surface-sunken)',
                overflow: 'hidden',
                margin: '4px 0 10px',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${o.compliance.readinessPct}%`,
                  background:
                    bandFor(o.compliance.readinessPct) === 'high'
                      ? 'var(--positive)'
                      : bandFor(o.compliance.readinessPct) === 'medium'
                        ? 'var(--attention)'
                        : 'var(--critical)',
                }}
              />
            </div>
            {o.compliance.topGaps.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {o.compliance.topGaps.map((g) => (
                  <li key={g.requiredDatapointKey}>
                    <Link
                      href={`/compliance/disclosures/${g.disclosureId}`}
                      style={{ color: 'var(--accent)' }}
                    >
                      {g.disclosureCode}
                    </Link>{' '}
                    — {g.label} <span className="tag">{g.status.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No open compliance gaps for this rule store.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Recent activity</h2>
        <table>
          <tbody>
            {o.recentActivity.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.action}</td>
                <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {o.recentActivity.length === 0 && (
              <tr>
                <td className="muted">No activity yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        <Link href="/audit/log" style={{ color: 'var(--accent)', fontSize: 13 }}>
          Full activity log →
        </Link>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  strong,
}: {
  label: string;
  value: string;
  unit?: string;
  strong?: boolean;
}) {
  return (
    <div className="card" style={strong ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="label">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>
        {value}
        {unit && value !== '—' ? (
          <span style={{ fontSize: 13, fontWeight: 400 }}> {unit}</span>
        ) : null}
      </div>
    </div>
  );
}
