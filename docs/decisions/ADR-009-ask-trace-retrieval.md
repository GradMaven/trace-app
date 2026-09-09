# ADR-009: Ask TRACE — retrieval-grounded NL analytics

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 10

## Context

Ask TRACE lets a sustainability professional ask questions in natural language.
`docs/ai-architecture.md` is strict: the model **must not** answer factual claims about the
tenant's data from parametric knowledge; every answer must be **grounded in retrieved
records** and **carry citations**; if retrieval returns nothing the answer says so; and
ADR-005 already forbids AI from "building SQL from its own free text". Every model call is a
recorded `ai_job` (§26).

## Options considered

### How the model reaches the data

- **A1 — Text-to-SQL.** The model writes a query, we run it. **Rejected** outright by
  ADR-005 and by the injection surface (a crafted question that exfiltrates or mutates).
- **A2 — Tool/function calling with a broad "query" tool.** Still lets the model shape
  arbitrary filters/joins; hard to bound and audit. Rejected.
- **A3 — Intent routing + a fixed catalog of hand-written retrievals.** The model does two
  narrow things only: (1) map the question to **one of a fixed set of intents** (+ an
  optional period), and (2) compose an answer **from a set of numbered records** that
  `@trace/db` fetched with hand-written, tenant-scoped Prisma queries. The model never
  chooses a table, a filter, or a join.
  - **Chosen.** 11 retrieval intents cover the example questions in ai-architecture.md
    (emissions summary / trend, top Scope 3 categories, top suppliers, missing evidence,
    estimated datapoints, outdated factors, low-Trust datapoints, compliance gaps, open
    findings, data-quality issues) plus `unsupported`.

### Grounding & citations

- The answer-composition prompt is hard-fenced: _use ONLY the numbered RECORDS; every
  factual statement must cite a record number; if the records don't answer it, say so and
  cite nothing_. The tool output is `{ answer, citedRefs: number[] }`.
- `@trace/db` maps `citedRefs` back to the retrieved records (each with a UI `href`) and
  stores them as `ask_query.citations`. `answered = citedRefs.length > 0`.
- If the retrieval yields **zero** records, the answer-composition call is **not made** at
  all — the response is a fixed "nothing to report" string, one `ai_job` (intent) only.
- `intent = "unsupported"` short-circuits the same way with a fixed "I only answer from your
  workspace's records" string.

### Recording

- Each of the (up to two) model calls is an `ai_job` row, capability `nl_analytics`,
  `inputType = "query"`, `inputRef = ask_query.id`, written **before** its output is used —
  identical to the Phase 5 extraction pipeline.
- The whole exchange is an `ask_query` row (RLS): question, intent, period, answer,
  `answered`, `recordCount`, `citations`, `aiJobIds`, provider/model, tokens/cost. It is a
  read, so no audit-log entry.

### Stub fallback

- `StubAIProvider` gains a deterministic `nl_analytics` path: keyword rules map the question
  to an intent and pull out `FY####` periods; the answer path summarises the numbered
  records and cites them (or says "could not find any records" when empty). Honest, clearly
  the stub (`provider: 'stub'`), never fake progress.

## Decision

- **`@trace/ai`**: `nl_analytics` schemas (`askIntentSchema`, `askAnswerSchema`, the fixed
  `ASK_INTENTS` catalog), two versioned prompts (`ask/intent@1`, `ask/answer@1`) with tool
  schemas, capabilities `classifyAskIntent` + `composeAskAnswer`, and the stub extension.
- **`@trace/db`**: `ask.ts` — the `RETRIEVALS` catalog (hand-written, tenant-scoped, capped
  at 40 rows each), the `runAskQuery` orchestrator, and `askHistory` / `askQueryById`.
  Model `ask_query`; migrations `0017_ask` + `0018_ask_rls`.
- **`apps/api`**: `AskModule` — `POST /ask`, `GET /ask/history`, `GET /ask/:id`, permission
  `ask.use` (granted to every internal role; not supplier users).
- **`apps/web`**: `/ask` — a question box with example prompts, the answer with clickable
  citation links and an intent / provider badge, and recent questions.
- Seed: four demo questions answered through the stub.

## Consequences

- New question types need a new intent **and** a hand-written retrieval — deliberate
  friction that keeps the data access surface small and auditable.
- Retrievals are single-period / simple aggregates today; richer comparisons (e.g. a
  computed year-on-year delta record) are easy follow-ups within the same shape.
- The intent classifier can misroute; a wrong intent yields "no records" rather than a
  wrong answer, which is the safe failure.
- With a real Claude key the answers are fluent; with the stub they are terse record
  summaries — both are correct and both cite their sources.
- Rate/cost ceilings per org (ai-architecture.md "Observability & safety controls") are not
  yet enforced for `nl_analytics`; the `ai_job` cost columns make that a later, additive
  change.
