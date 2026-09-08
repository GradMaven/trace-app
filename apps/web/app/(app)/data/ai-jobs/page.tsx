import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface AiJob {
  id: string;
  capability: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: string;
  confidence: string | null;
  tokensIn: number;
  tokensOut: number;
  costEur: string;
  latencyMs: number;
  createdAt: string;
}

export default async function AiJobsPage() {
  const res = await serverFetch<{ data: AiJob[] }>('/ai-jobs?limit=200');
  const rows = res.data?.data ?? [];
  const totalCost = rows.reduce((a, j) => a + Number(j.costEur), 0);
  const totalTokens = rows.reduce((a, j) => a + j.tokensIn + j.tokensOut, 0);

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>AI Log</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Every AI (or dev-stub) call is recorded before its output is used — model, prompt version,
        tokens, cost, latency, status, and the reviewer who acted on it.
      </p>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <div style={{ display: 'flex', gap: 16, margin: '12px 0' }}>
        <div className="card">
          <div className="label">Calls</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{rows.length}</div>
        </div>
        <div className="card">
          <div className="label">Tokens</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{totalTokens.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="label">Est. cost</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>€{totalCost.toFixed(4)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Capability</th>
              <th>Provider / model</th>
              <th>Prompt</th>
              <th>Status</th>
              <th>Confidence</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Latency</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id}>
                <td>{j.capability}</td>
                <td>
                  {j.provider === 'stub' ? (
                    <span className="tag" style={{ color: 'var(--attention)' }}>
                      stub
                    </span>
                  ) : (
                    <span className="tag">{j.provider}</span>
                  )}{' '}
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {j.model}
                  </span>
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {j.promptVersion}
                </td>
                <td>
                  <span
                    className="tag"
                    style={{ color: j.status === 'completed' ? 'var(--positive)' : j.status === 'failed' ? 'var(--critical)' : undefined }}
                  >
                    {j.status}
                  </span>
                </td>
                <td>{j.confidence ? Math.round(Number(j.confidence)) : '—'}</td>
                <td className="muted">{(j.tokensIn + j.tokensOut).toLocaleString()}</td>
                <td className="muted">€{Number(j.costEur).toFixed(4)}</td>
                <td className="muted">{j.latencyMs} ms</td>
                <td className="muted">{new Date(j.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No AI calls yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
