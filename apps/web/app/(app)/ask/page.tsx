import { serverFetch } from '@/lib/server-api';
import { AskClient } from './ask-client';

export const dynamic = 'force-dynamic';

interface HistoryItem {
  id: string;
  question: string;
  intent: string;
  answered: boolean;
  answer: string;
  recordCount: number;
  createdAt: string;
}

export default async function AskPage() {
  const res = await serverFetch<HistoryItem[]>('/ask/history?limit=15');
  const history = res.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 820 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Ask TRACE</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Natural-language questions answered{' '}
          <strong>only from this workspace&apos;s own structured records</strong> — emissions,
          datapoints, evidence, calculations, emission factors, compliance status and audit
          findings. Every answer is grounded in retrieved records and cites them; if there&apos;s no
          data, it says so. The model never answers from outside knowledge and never writes a query.
        </p>
      </div>

      <AskClient />

      {history.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Recent questions</h2>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {history.map((h) => (
              <li
                key={h.id}
                style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{h.question}</div>
                <div
                  className="muted"
                  style={{ fontSize: 13, marginTop: 2, whiteSpace: 'pre-wrap' }}
                >
                  {h.answer}
                </div>
                <div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {h.intent} · {h.answered ? `${h.recordCount} records` : 'not answered from data'}{' '}
                  · {new Date(h.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
