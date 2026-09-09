import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { Disclaimer, GapReasons, StatusChip } from '@/components/compliance-bits';

export const dynamic = 'force-dynamic';

interface Gap {
  mappingId: string;
  status: string;
  gapReasons: string[];
  requiredDatapoint: { key: string; label: string; metricKey: string };
  disclosure: { id: string; code: string; title: string };
  requirement: { code: string; title: string };
  datapointIds: string[];
}

export default async function GapsPage() {
  const res = await serverFetch<Gap[]>('/compliance/gaps?version=esrs@2026.1');
  const gaps = res.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Compliance — Gaps</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Required datapoints that are missing, lack evidence, or need review. Each links straight
          to the object to fix.
        </p>
      </div>
      <Disclaimer />
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Required datapoint</th>
              <th>Disclosure</th>
              <th>Status</th>
              <th>Why</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={g.mappingId}>
                <td>
                  <div>{g.requiredDatapoint.label}</div>
                  <div className="mono muted" style={{ fontSize: 11 }}>
                    {g.requiredDatapoint.metricKey}
                  </div>
                </td>
                <td className="muted">
                  {g.requirement.code} · {g.disclosure.code}
                </td>
                <td>
                  <StatusChip status={g.status} />
                </td>
                <td>
                  <GapReasons reasons={g.gapReasons} />
                </td>
                <td>
                  <Link
                    href={`/compliance/disclosures/${g.disclosure.id}`}
                    style={{ color: 'var(--accent)', fontSize: 13 }}
                  >
                    open →
                  </Link>
                </td>
              </tr>
            ))}
            {gaps.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No open gaps — or the rule store has not been evaluated yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
