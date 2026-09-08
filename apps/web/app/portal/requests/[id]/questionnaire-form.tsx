'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

interface Option {
  value: string;
  label: string;
}
interface Question {
  id: string;
  label: string;
  help?: string;
  kind: 'text' | 'number' | 'boolean' | 'single_select' | 'multi_select';
  unit?: string;
  required: boolean;
  options?: Option[];
}
export interface Section {
  id: string;
  title: string;
  questions: Question[];
}

type Responses = Record<string, unknown>;

export function QuestionnaireForm({
  requestId,
  sections,
  initialResponses,
  locked,
}: {
  requestId: string;
  sections: Section[];
  initialResponses: Responses;
  locked: boolean;
}) {
  const router = useRouter();
  const [responses, setResponses] = useState<Responses>(initialResponses ?? {});
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const allQuestions = useMemo(() => sections.flatMap((s) => s.questions), [sections]);
  const answered = allQuestions.filter((q) => {
    const v = responses[q.id];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;
  const completeness = Math.round((answered / allQuestions.length) * 100);

  function set(id: string, value: unknown) {
    setResponses((r) => ({ ...r, [id]: value }));
    setIssues((i) => {
      if (!i[id]) return i;
      const next = { ...i };
      delete next[id];
      return next;
    });
  }

  async function save() {
    setBusy('save');
    setMsg(null);
    const res = await clientFetch<{ completeness: number }>(
      `/supplier-portal/requests/${requestId}/responses`,
      { method: 'PUT', body: JSON.stringify({ responses }) },
    );
    setBusy(null);
    if (res.ok) setMsg({ kind: 'ok', text: 'Draft saved.' });
    else setMsg({ kind: 'err', text: res.error?.message ?? 'Could not save.' });
  }

  async function submit() {
    setBusy('submit');
    setMsg(null);
    setIssues({});
    const saveRes = await clientFetch(`/supplier-portal/requests/${requestId}/responses`, {
      method: 'PUT',
      body: JSON.stringify({ responses }),
    });
    if (!saveRes.ok) {
      setBusy(null);
      setMsg({ kind: 'err', text: saveRes.error?.message ?? 'Could not save.' });
      return;
    }
    const res = await clientFetch(`/supplier-portal/requests/${requestId}/submit`, { method: 'POST' });
    setBusy(null);
    if (res.ok) {
      router.push('/portal');
      return;
    }
    const fieldIssues: Record<string, string> = {};
    for (const d of res.error?.details ?? []) {
      if (d.path) fieldIssues[d.path] = d.message;
    }
    if (Object.keys(fieldIssues).length === 0) {
      for (const q of allQuestions) {
        const v = responses[q.id];
        if (q.required && (v === undefined || v === null || v === '')) fieldIssues[q.id] = 'Required';
      }
    }
    setIssues(fieldIssues);
    setMsg({
      kind: 'err',
      text: res.error?.message ?? 'Please complete the required questions before submitting.',
    });
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted">{completeness}% complete</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => void save()} disabled={locked || busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={locked || busy !== null}
            >
              {busy === 'submit' ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
        {msg && (
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 13,
              color: msg.kind === 'ok' ? 'var(--positive)' : 'var(--critical)',
            }}
          >
            {msg.text}
          </p>
        )}
      </div>

      {sections.map((section) => (
        <section key={section.id} className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>{section.title}</h2>
          <div style={{ display: 'grid', gap: 14 }}>
            {section.questions.map((q) => (
              <Field
                key={q.id}
                q={q}
                value={responses[q.id]}
                issue={issues[q.id]}
                disabled={locked}
                onChange={(v) => set(q.id, v)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Field({
  q,
  value,
  issue,
  disabled,
  onChange,
}: {
  q: Question;
  value: unknown;
  issue?: string;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label className="label">
        {q.label}
        {q.required && <span style={{ color: 'var(--critical)' }}> *</span>}
        {q.unit ? <span className="muted"> ({q.unit})</span> : null}
      </label>
      {q.help && (
        <span className="muted" style={{ fontSize: 12 }}>
          {q.help}
        </span>
      )}
      {q.kind === 'boolean' ? (
        <select
          className="input"
          disabled={disabled}
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : q.kind === 'single_select' ? (
        <select
          className="input"
          disabled={disabled}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">—</option>
          {q.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : q.kind === 'multi_select' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {q.options?.map((o) => {
            const arr = Array.isArray(value) ? (value as string[]) : [];
            const on = arr.includes(o.value);
            return (
              <button
                type="button"
                key={o.value}
                className="tag"
                disabled={disabled}
                onClick={() =>
                  onChange(on ? arr.filter((v) => v !== o.value) : [...arr, o.value])
                }
                style={{
                  cursor: disabled ? 'default' : 'pointer',
                  background: on ? 'var(--accent)' : 'transparent',
                  color: on ? 'var(--accent-contrast)' : 'var(--text-secondary)',
                  borderColor: on ? 'var(--accent)' : 'var(--border)',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ) : (
        <input
          className="input"
          type={q.kind === 'number' ? 'number' : 'text'}
          disabled={disabled}
          value={(value as string | number | undefined) ?? ''}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? undefined
                : q.kind === 'number'
                  ? Number(e.target.value)
                  : e.target.value,
            )
          }
        />
      )}
      {issue && <span style={{ color: 'var(--critical)', fontSize: 12 }}>{issue}</span>}
    </div>
  );
}
