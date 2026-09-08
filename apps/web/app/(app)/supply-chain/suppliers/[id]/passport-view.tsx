const PROVENANCE_COLOR: Record<string, string> = {
  measured: 'var(--positive)',
  supplier_reported: 'var(--info)',
  calculated: 'var(--info)',
  estimated: 'var(--attention)',
  modeled: 'var(--attention)',
  inferred: 'var(--attention)',
  not_provided: 'var(--text-muted)',
};

interface Field {
  value: unknown;
  provenance: string;
  unit?: string;
}

function Row({ label, field }: { label: string; field: Field | undefined }) {
  if (!field) return null;
  const display =
    field.value === null || field.value === undefined
      ? '—'
      : Array.isArray(field.value)
        ? field.value.join(', ')
        : typeof field.value === 'boolean'
          ? field.value
            ? 'Yes'
            : 'No'
          : String(field.value);
  return (
    <tr>
      <td className="muted" style={{ width: '40%' }}>
        {label}
      </td>
      <td>
        {display}
        {field.unit && field.value !== null ? ` ${field.unit}` : ''}
      </td>
      <td style={{ textAlign: 'right' }}>
        <span
          className="tag"
          style={{ color: PROVENANCE_COLOR[field.provenance], borderColor: 'var(--border-subtle)' }}
        >
          {field.provenance.replace('_', ' ')}
        </span>
      </td>
    </tr>
  );
}

/**
 * Renders the Supplier Passport (PassportData from @trace/domain). Every value
 * shows its provenance — a supplier-reported figure is never styled as verified.
 */
export function PassportView({ data }: { data: unknown }) {
  const p = data as {
    identity: Record<string, Field>;
    carbon: Record<string, Field>;
    environmental: Record<string, Field>;
    social: Record<string, Field>;
    governance: Record<string, Field>;
    relationship: Record<string, Field>;
    evidence: { attached: number; verified: number; latestReportingPeriod: string | null };
  } | null;
  if (!p) return <p className="muted">No passport data.</p>;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {(
        [
          ['Identity & reporting', p.identity],
          ['Carbon & energy', p.carbon],
          ['Environmental', p.environmental],
          ['Social & labour', p.social],
          ['Governance', p.governance],
        ] as const
      ).map(([title, block]) => (
        <div key={title}>
          <div className="label" style={{ marginBottom: 4 }}>
            {title}
          </div>
          <table>
            <tbody>
              {Object.entries(block).map(([k, field]) => (
                <Row key={k} label={humanize(k)} field={field} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>
        Evidence attached: {p.evidence.attached} ({p.evidence.verified} verified)
        {p.evidence.latestReportingPeriod ? ` · latest period ${p.evidence.latestReportingPeriod}` : ''}
      </p>
    </div>
  );
}

function humanize(k: string): string {
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bPct\b/, '%')
    .replace(/\bM3\b/, '(m³)')
    .replace(/\bIso\b/, 'ISO')
    .replace(/\bTrir\b/, 'TRIR')
    .replace(/\bGhg\b/, 'GHG')
    .replace(/\bNace\b/, 'NACE');
}
