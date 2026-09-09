'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

interface Citation {
  ref: number;
  kind: string;
  title: string;
  detail: string;
  href: string | null;
}

interface AskResult {
  id: string;
  intent: string;
  reportingPeriod: string | null;
  answered: boolean;
  answer: string;
  recordCount: number;
  citations: Citation[];
  provider: string;
  model: string;
}

const EXAMPLES = [
  'What are our Scope 1, 2 and 3 emissions this year?',
  'Why did total emissions change versus last year?',
  'Which Scope 3 categories are largest?',
  'Which datapoints have no supporting evidence?',
  'Which figures are estimated rather than measured?',
  'Which ESRS disclosures are still incomplete?',
  'Do any calculations use an outdated emission factor?',
];

export function AskClient() {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    const res = await clientFetch<AskResult>('/ask', {
      method: 'POST',
      body: JSON.stringify({ question: text }),
    });
    setBusy(false);
    if (res.ok && res.data) {
      setResult(res.data);
      router.refresh();
    } else {
      setErr(res.error?.message ?? 'Ask failed.');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="Ask about your emissions, evidence, calculations, compliance status, findings…"
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            font: 'inherit',
            resize: 'vertical',
          }}
        />
        <button className="btn" type="submit" disabled={busy || question.trim().length < 3}>
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </form>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="tag"
            style={{ cursor: 'pointer', border: 'none' }}
            onClick={() => {
              setQuestion(ex);
              void ask(ex);
            }}
            disabled={busy}
          >
            {ex}
          </button>
        ))}
      </div>

      {err && <p style={{ color: 'var(--critical)' }}>{err}</p>}

      {result && (
        <div className="card">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            {result.answered ? (
              <>Answered from {result.recordCount} record(s) in your workspace.</>
            ) : (
              <>Not answered from your data.</>
            )}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result.answer}</p>

          {result.citations.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="label">Sources</div>
              <ol
                style={{
                  margin: '4px 0 0',
                  paddingLeft: 20,
                  display: 'grid',
                  gap: 4,
                  fontSize: 13,
                }}
              >
                {result.citations.map((c) => (
                  <li key={c.ref} value={c.ref}>
                    {c.href ? (
                      <Link href={c.href} style={{ color: 'var(--accent)' }}>
                        {c.title}
                      </Link>
                    ) : (
                      <span>{c.title}</span>
                    )}{' '}
                    <span className="muted">
                      — {c.detail} <span className="tag">{c.kind}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="mono muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
            intent: {result.intent}
            {result.reportingPeriod ? ` · ${result.reportingPeriod}` : ''} ·{' '}
            {result.provider === 'stub' ? 'heuristic dev stub' : result.provider} / {result.model}
          </p>
        </div>
      )}
    </div>
  );
}
