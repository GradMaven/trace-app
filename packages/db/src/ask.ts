import {
  classifyAskIntent,
  composeAskAnswer,
  ASK_ANSWER_PROMPT_VERSION,
  ASK_INTENT_PROMPT_VERSION,
  type AIProvider,
  type AskIntent,
  type AskRecordForModel,
  type StructuredResult,
} from '@trace/ai';
import { AppError } from '@trace/shared';
import { complianceGaps } from './compliance';
import { inventorySummary } from './carbon';
import { type Prisma, type TenantDb } from './client';

/**
 * Ask TRACE (Phase 10). Natural-language questions answered by **retrieval over
 * the tenant's own records**, never by the model's parametric knowledge:
 *
 *   question → classifyAskIntent (model) → pick a hand-written retrieval →
 *   run it (tenant-scoped, no dynamic SQL) → composeAskAnswer (model, grounded
 *   only in the numbered records) → persist with citations.
 *
 * Both model calls are recorded as `ai_job` rows (capability `nl_analytics`)
 * before their output is used. If retrieval returns nothing, the answer says so
 * and no answer-composition call is made. `db` must already be a tenant
 * transaction.
 */

const DEFAULT_RULE_STORE_VERSION = 'esrs@2026.1';
const MAX_RECORDS = 40;
const DEAD_EVIDENCE = new Set(['rejected', 'superseded']);

function activePeriod(configured: unknown, explicit: string | null): string {
  if (explicit) return explicit;
  if (configured && typeof configured === 'object' && 'activePeriod' in configured) {
    const v = (configured as { activePeriod?: unknown }).activePeriod;
    if (typeof v === 'string' && v) return v;
  }
  return `FY${new Date().getFullYear() - 1}`;
}

function periodYear(label: string | null): number | null {
  const m = label?.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function n(v: { toString(): string } | null | undefined): string {
  return v == null ? '—' : Number(v).toLocaleString('en-US');
}

function dpValue(d: {
  valueNumeric: { toString(): string } | null;
  valueText: string | null;
}): string {
  if (d.valueNumeric != null) return Number(d.valueNumeric).toLocaleString('en-US');
  return d.valueText ?? '—';
}

// ---------------------------------------------------------------------------
// Retrieved-record shapes
// ---------------------------------------------------------------------------

export interface RetrievedRecord {
  ref: number;
  kind: string;
  title: string;
  detail: string;
  href: string | null;
}

type RawRecord = Omit<RetrievedRecord, 'ref'>;

interface RetrievalContext {
  period: string;
  comparePeriod: string | null;
  asOf: string;
}

type Retrieval = (
  db: TenantDb,
  organizationId: string,
  ctx: RetrievalContext,
) => Promise<RawRecord[]>;

// ---------------------------------------------------------------------------
// Retrievals — hand-written, tenant-scoped. No model-authored queries.
// ---------------------------------------------------------------------------

const emissionsSummary: Retrieval = async (db, organizationId, ctx) => {
  const s = await inventorySummary(db, organizationId, ctx.period);
  return [
    {
      kind: 'emission',
      title: `Scope 1 (${ctx.period})`,
      detail: `${n(s.scope1)} tCO2e`,
      href: '/carbon/scope-1',
    },
    {
      kind: 'emission',
      title: `Scope 2 — reported (${ctx.period})`,
      detail: `${n(s.scope2Reported)} tCO2e`,
      href: '/carbon/scope-2',
    },
    {
      kind: 'emission',
      title: `Scope 2 — location-based (${ctx.period})`,
      detail: `${n(s.scope2LocationBased)} tCO2e`,
      href: '/carbon/scope-2',
    },
    {
      kind: 'emission',
      title: `Scope 2 — market-based (${ctx.period})`,
      detail: `${n(s.scope2MarketBased)} tCO2e`,
      href: '/carbon/scope-2',
    },
    {
      kind: 'emission',
      title: `Scope 3 (${ctx.period})`,
      detail: `${n(s.scope3)} tCO2e`,
      href: '/carbon/scope-3',
    },
    {
      kind: 'emission',
      title: `Total gross GHG (${ctx.period})`,
      detail: `${n(s.total)} tCO2e`,
      href: '/command-center',
    },
  ];
};

const emissionsTrend: Retrieval = async (db, organizationId) => {
  const periodRows = await db.calculation.groupBy({
    by: ['reportingPeriod'],
    where: { organizationId, supersededBy: { none: {} } },
  });
  const periods = periodRows.map((r) => r.reportingPeriod).sort();
  const out: RawRecord[] = [];
  for (const p of periods) {
    const s = await inventorySummary(db, organizationId, p);
    out.push({
      kind: 'emission',
      title: `Total gross GHG ${p}`,
      detail: `${n(s.total)} tCO2e (Scope 1 ${n(s.scope1)}, Scope 2 ${n(s.scope2Reported)}, Scope 3 ${n(s.scope3)})`,
      href: '/command-center',
    });
  }
  return out;
};

const topScope3Categories: Retrieval = async (db, organizationId, ctx) => {
  const s = await inventorySummary(db, organizationId, ctx.period);
  return s.byCategory
    .filter((c) => c.scope === 'scope_3')
    .sort((a, b) => Number(b.valueTco2e) - Number(a.valueTco2e))
    .map((c) => ({
      kind: 'emission',
      title: `Scope 3 — ${String(c.ghgCategory ?? 'uncategorised')
        .replace(/^cat_\d+_/, '')
        .replace(/_/g, ' ')}`,
      detail: `${n(c.valueTco2e)} tCO2e across ${c.count} calculation(s)`,
      href: '/carbon/scope-3',
    }));
};

const topSuppliersByEmissions: Retrieval = async (db, organizationId, ctx) => {
  const grouped = await db.datapoint.groupBy({
    by: ['subjectId'],
    where: {
      organizationId,
      subjectType: 'supplier',
      metricKey: { startsWith: 'emission_' },
      reportingPeriod: ctx.period,
    },
    _sum: { valueNumeric: true },
  });
  if (grouped.length === 0) return [];
  const suppliers = await db.supplier.findMany({
    where: { organizationId, id: { in: grouped.map((g) => g.subjectId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
  return grouped
    .map((g) => ({ id: g.subjectId, total: Number(g._sum.valueNumeric ?? 0) }))
    .sort((a, b) => b.total - a.total)
    .map((g) => ({
      kind: 'supplier',
      title: nameById.get(g.id) ?? `Supplier ${g.id.slice(0, 8)}`,
      detail: `${g.total.toLocaleString('en-US')} tCO2e attributed (${ctx.period})`,
      href: `/supply-chain/suppliers/${g.id}`,
    }));
};

const missingEvidence: Retrieval = async (db, organizationId, ctx) => {
  const rows = await db.datapoint.findMany({
    where: { organizationId, reportingPeriod: ctx.period },
    include: { evidence: { include: { evidence: { select: { status: true, expiresAt: true } } } } },
    orderBy: { metricKey: 'asc' },
  });
  const out: RawRecord[] = [];
  for (const d of rows) {
    const live = d.evidence.filter((link) => {
      const ev = link.evidence;
      if (DEAD_EVIDENCE.has(ev.status)) return false;
      return !(ev.expiresAt != null && isoDate(ev.expiresAt) < ctx.asOf);
    });
    if (live.length === 0) {
      out.push({
        kind: 'datapoint',
        title: d.metricKey,
        detail: `${dpValue(d)}${d.unit ? ` ${d.unit}` : ''} · ${d.provenance} · no live evidence`,
        href: `/data/datapoints/${d.id}`,
      });
    }
  }
  return out;
};

const estimatedDatapoints: Retrieval = async (db, organizationId, ctx) => {
  const rows = await db.datapoint.findMany({
    where: {
      organizationId,
      reportingPeriod: ctx.period,
      provenance: { in: ['estimated', 'modeled', 'inferred'] },
    },
    orderBy: { metricKey: 'asc' },
    take: MAX_RECORDS,
  });
  return rows.map((d) => ({
    kind: 'datapoint',
    title: d.metricKey,
    detail: `${dpValue(d)}${d.unit ? ` ${d.unit}` : ''} · provenance "${d.provenance}"`,
    href: `/data/datapoints/${d.id}`,
  }));
};

const outdatedFactors: Retrieval = async (db, organizationId, ctx) => {
  const calcs = await db.calculation.findMany({
    where: { organizationId, supersededBy: { none: {} } },
    include: {
      emissionFactor: { select: { source: true, sourceRef: true, validTo: true } },
      activity: { select: { occurredOn: true, category: true } },
    },
  });
  const out: RawRecord[] = [];
  for (const c of calcs) {
    const validTo = c.emissionFactor.validTo ? isoDate(c.emissionFactor.validTo) : null;
    const asOf = c.activity?.occurredOn ? isoDate(c.activity.occurredOn) : ctx.asOf;
    if (validTo && validTo < asOf) {
      out.push({
        kind: 'calculation',
        title: `${c.scope} · ${c.activity?.category ?? 'activity'}`,
        detail: `factor ${c.emissionFactor.source}:${c.emissionFactor.sourceRef} expired ${validTo}, activity dated ${asOf}`,
        href: '/data/calculations',
      });
    }
  }
  return out;
};

const lowTrustDatapoints: Retrieval = async (db, organizationId) => {
  const rows = await db.trustScore.findMany({
    where: { organizationId, supersededBy: { none: {} }, value: { lt: 50 } },
    orderBy: { value: 'asc' },
    take: MAX_RECORDS,
  });
  return rows.map((t) => ({
    kind: 'trust',
    title: t.metricKey,
    detail: `Trust Score ${t.value}/100 (${t.band})${t.reportingPeriod ? ` · ${t.reportingPeriod}` : ''}`,
    href: `/data/datapoints/${t.datapointId}`,
  }));
};

const complianceGapsRetrieval: Retrieval = async (db, organizationId) => {
  const gaps = (await complianceGaps(db, organizationId, DEFAULT_RULE_STORE_VERSION)) as Array<{
    status: string;
    gapReasons: string[];
    requiredDatapoint: { key: string; label: string };
    disclosure: { id: string; code: string };
  }>;
  return gaps.map((g) => ({
    kind: 'compliance',
    title: `${g.disclosure.code} — ${g.requiredDatapoint.label}`,
    detail: `${g.status.replace(/_/g, ' ')} · ${g.gapReasons.map((r) => r.replace(/_/g, ' ')).join(', ') || 'no data'}`,
    href: `/compliance/disclosures/${g.disclosure.id}`,
  }));
};

const openFindings: Retrieval = async (db, organizationId) => {
  const rows = await db.auditFinding.findMany({
    where: { organizationId, status: { in: ['open', 'acknowledged', 'remediating'] } },
    orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
    take: MAX_RECORDS,
  });
  return rows.map((f) => ({
    kind: 'finding',
    title: f.title,
    detail: `${f.severity} · ${f.status} · ${f.kind ?? 'manual'}`,
    href: '/audit/findings',
  }));
};

const dataQualityIssues: Retrieval = async (db, organizationId) => {
  const rows = await db.dataQualityIssue.findMany({
    where: { organizationId, status: { in: ['open', 'acknowledged'] } },
    orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
    take: MAX_RECORDS,
  });
  return rows.map((i) => ({
    kind: 'quality',
    title: i.title,
    detail: `${i.severity} · ${i.kind.replace(/_/g, ' ')}${i.metricKey ? ` · ${i.metricKey}` : ''}`,
    href: '/data/quality/issues',
  }));
};

const RETRIEVALS: Partial<Record<AskIntent, Retrieval>> = {
  emissions_summary: emissionsSummary,
  emissions_trend: emissionsTrend,
  top_scope3_categories: topScope3Categories,
  top_suppliers_by_emissions: topSuppliersByEmissions,
  missing_evidence: missingEvidence,
  estimated_datapoints: estimatedDatapoints,
  outdated_factors: outdatedFactors,
  low_trust_datapoints: lowTrustDatapoints,
  compliance_gaps: complianceGapsRetrieval,
  open_findings: openFindings,
  data_quality_issues: dataQualityIssues,
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface AskDeps {
  provider: AIProvider;
}

export interface RunAskQueryArgs {
  organizationId: string;
  question: string;
  actorUserId?: string;
  requestId: string;
}

export interface RunAskQueryResult {
  id: string;
  intent: string;
  reportingPeriod: string | null;
  answered: boolean;
  answer: string;
  recordCount: number;
  citations: RetrievedRecord[];
  aiJobIds: string[];
  provider: string;
  model: string;
}

async function recordAskAiJob<T>(
  db: TenantDb,
  base: { organizationId: string; promptVersion: string; inputRef: string },
  call: () => Promise<StructuredResult<T>>,
): Promise<{ jobId: string; result: StructuredResult<T> }> {
  const job = await db.aiJob.create({
    data: {
      organizationId: base.organizationId,
      capability: 'nl_analytics',
      provider: 'pending',
      model: 'pending',
      promptVersion: base.promptVersion,
      inputType: 'query',
      inputRef: base.inputRef,
      status: 'running',
    },
  });
  try {
    const result = await call();
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        provider: result.provider,
        model: result.model,
        status: 'completed',
        output: result.output as Prisma.InputJsonValue,
        confidence: result.confidence,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costEur: result.costEur,
        latencyMs: result.latencyMs,
        completedAt: new Date(),
      },
    });
    return { jobId: job.id, result };
  } catch (err) {
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

export async function runAskQuery(
  db: TenantDb,
  deps: AskDeps,
  args: RunAskQueryArgs,
): Promise<RunAskQueryResult> {
  const question = args.question.trim();
  if (!question) throw AppError.unprocessable('ask.empty', 'Ask a question first.');

  const row = await db.askQuery.create({
    data: {
      organizationId: args.organizationId,
      question: question.slice(0, 2000),
      intent: 'pending',
      askedByUserId: args.actorUserId ?? null,
    },
  });

  const { jobId: intentJobId, result: intentResult } = await recordAskAiJob(
    db,
    {
      organizationId: args.organizationId,
      promptVersion: ASK_INTENT_PROMPT_VERSION,
      inputRef: row.id,
    },
    () => classifyAskIntent(deps.provider, { question }),
  );
  const intent = intentResult.output.intent;

  const org = await db.organization.findUniqueOrThrow({ where: { id: args.organizationId } });
  const period = activePeriod(org.reportingPeriodConfig, intentResult.output.reportingPeriod);
  const ctx: RetrievalContext = {
    period,
    comparePeriod: intentResult.output.comparePeriod,
    asOf: `${periodYear(period) ?? new Date().getFullYear()}-12-31`,
  };

  const retrieval = RETRIEVALS[intent];
  const raw = retrieval ? await retrieval(db, args.organizationId, ctx) : [];
  const records: RetrievedRecord[] = raw
    .slice(0, MAX_RECORDS)
    .map((r, i) => ({ ref: i + 1, ...r }));

  const finish = async (
    answered: boolean,
    answer: string,
    citations: RetrievedRecord[],
    aiJobIds: string[],
    prov: {
      provider: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      costEur: number;
      latencyMs: number;
    },
  ): Promise<RunAskQueryResult> => {
    await db.askQuery.update({
      where: { id: row.id },
      data: {
        intent,
        reportingPeriod: retrieval ? period : null,
        answered,
        answer,
        recordCount: records.length,
        citations: citations as unknown as Prisma.InputJsonValue,
        aiJobIds,
        provider: prov.provider,
        model: prov.model,
        tokensIn: prov.tokensIn,
        tokensOut: prov.tokensOut,
        costEur: prov.costEur.toString(),
        latencyMs: prov.latencyMs,
      },
    });
    return {
      id: row.id,
      intent,
      reportingPeriod: retrieval ? period : null,
      answered,
      answer,
      recordCount: records.length,
      citations,
      aiJobIds,
      provider: prov.provider,
      model: prov.model,
    };
  };

  if (intent === 'unsupported') {
    return finish(
      false,
      "Ask TRACE answers only from this workspace's own structured records — emissions, datapoints, evidence, calculations, emission factors, compliance status and audit findings. I can't answer that from your data.",
      [],
      [intentJobId],
      {
        provider: intentResult.provider,
        model: intentResult.model,
        tokensIn: intentResult.tokensIn,
        tokensOut: intentResult.tokensOut,
        costEur: intentResult.costEur,
        latencyMs: intentResult.latencyMs,
      },
    );
  }

  if (records.length === 0) {
    return finish(
      false,
      `I couldn't find any records in this workspace for that (${intent.replace(/_/g, ' ')}). Nothing to report.`,
      [],
      [intentJobId],
      {
        provider: intentResult.provider,
        model: intentResult.model,
        tokensIn: intentResult.tokensIn,
        tokensOut: intentResult.tokensOut,
        costEur: intentResult.costEur,
        latencyMs: intentResult.latencyMs,
      },
    );
  }

  const modelRecords: AskRecordForModel[] = records.map((r) => ({
    ref: r.ref,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
  }));
  const { jobId: answerJobId, result: answerResult } = await recordAskAiJob(
    db,
    {
      organizationId: args.organizationId,
      promptVersion: ASK_ANSWER_PROMPT_VERSION,
      inputRef: row.id,
    },
    () => composeAskAnswer(deps.provider, { question, intent, records: modelRecords }),
  );

  const citedRefs = new Set(answerResult.output.citedRefs);
  const citations = citedRefs.size > 0 ? records.filter((r) => citedRefs.has(r.ref)) : [];
  const answered = citations.length > 0;

  return finish(answered, answerResult.output.answer, citations, [intentJobId, answerJobId], {
    provider: answerResult.provider,
    model: answerResult.model,
    tokensIn: intentResult.tokensIn + answerResult.tokensIn,
    tokensOut: intentResult.tokensOut + answerResult.tokensOut,
    costEur: intentResult.costEur + answerResult.costEur,
    latencyMs: intentResult.latencyMs + answerResult.latencyMs,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function toView(q: {
  id: string;
  question: string;
  intent: string;
  reportingPeriod: string | null;
  answered: boolean;
  answer: string;
  recordCount: number;
  citations: unknown;
  provider: string | null;
  model: string | null;
  aiJobIds: string[];
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: q.id,
    question: q.question,
    intent: q.intent,
    reportingPeriod: q.reportingPeriod,
    answered: q.answered,
    answer: q.answer,
    recordCount: q.recordCount,
    citations: q.citations,
    provider: q.provider,
    model: q.model,
    aiJobIds: q.aiJobIds,
    createdAt: q.createdAt.toISOString(),
  };
}

export async function askHistory(
  db: TenantDb,
  organizationId: string,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  const rows = await db.askQuery.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toView);
}

export async function askQueryById(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<Record<string, unknown>> {
  const q = await db.askQuery.findFirst({ where: { id, organizationId } });
  if (!q) throw AppError.notFound('ask.not_found', 'Ask query not found.');
  return toView(q);
}
