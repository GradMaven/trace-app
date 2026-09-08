# ADR-005: AI architecture

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 0

## Context

TRACE uses AI to turn supplier documents into structured sustainability data and to power
analytics (Ask TRACE), quality checks and recommendations. The brief is strict: AI may
extract, classify, calculate candidates, flag, recommend and explain, but must **not**
silently make consequential compliance decisions (Principle 4); AI output must be labelled
(§27); there must be **no fake AI** (§43); every automated calculation must be reproducible
(§8). AI calls must be observable (§26).

## Options considered

### Orchestration

- **A1 — One monolithic "AI service"** that does everything behind one endpoint.
  - Cons: opaque; hard to version prompts per task; hard to attribute cost/quality; couples
    unrelated capabilities.
- **A2 — An orchestrator + specialised capability modules**, each with a typed contract and
  its own versioned prompts.
  - Pros: independent versioning, evaluation and cost tracking; matches brief §26.
  - **Chosen.**

### Framework

- **B1 — LangChain / LlamaIndex as the backbone.**
  - Cons: heavy abstraction churn; harder to audit exactly what prompt/context was sent;
    indirection works against Principles 4/8/27.
- **B2 — A thin `AIProvider` interface + explicit prompt templates + Zod output schemas.**
  - Pros: every call is legible; provider-swappable; output validated deterministically.
  - **Chosen.**

### Trust boundary

- **C1 — AI writes datapoints directly, humans audit after.** Rejected — violates
  Principle 4; risk of estimates entering trusted reporting.
- **C2 — AI writes only `candidate_datapoint`; a permissioned human promotes.**
  - **Chosen.**

## Decision

### Capabilities

An **AI Orchestrator** plus modules in `packages/ai`: Document Extraction · Classification ·
Data Quality (assist) · Evidence Reasoning · Compliance Mapping (suggest) · NL Analytics
(Ask TRACE) · Recommendations. Each has a typed input/output contract and versioned
prompt(s) at `packages/ai/prompts/<capability>/<name>@<n>.md`.

### Provider abstraction

```ts
interface AIProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  extractStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
```

Default: **Anthropic Claude** — `claude-sonnet-5` (extraction/reasoning),
`claude-haiku-4-5` (classification/high-volume). Domain/API code depends only on the
interface.

### Pipeline (deterministic-first)

`receive → store original → malware scan → extract text → extract tables → persist parsed
artifact → classify → locate relevant content → structured extraction (value, unit,
provenance guess, source_spans, per-field confidence) → create candidate_datapoint (pending)
→ enqueue human review`. The model receives bounded, cited context — never "the whole
document, figure it out".

### Human-in-the-loop

AI never writes `datapoint`, `activity_data`, `emission`, `compliance_mapping` or
`audit_finding`. It writes `candidate_datapoint`. A user with the right permission
**promotes** (→ `datapoint`, `label = human_reviewed`, evidence linked), edits+promotes, or
rejects. `verified` requires a second permissioned verifier or a documented deterministic
validator. `ai_extracted → verified` automatically is disallowed.

### Observability — every call is an `AIJob`

`{ capability, model, promptVersion, inputType, inputRef, output, confidence, tokensIn,
tokensOut, costEur, latencyMs, reviewerId?, status, createdAt }`. `inputRef` is an
identifier, not raw sensitive content. OTel span per call, child of the request/job.
Per-org rate and cost ceilings.

### Ask TRACE

Retrieval-grounded only: parse intent → query the tenant's own structured records + evidence
index → answer strictly from retrieved rows → attach citations to TRACE records. No answer
from parametric knowledge for tenant-data facts; empty retrieval → say so. Unlinked factual
claims are a bug.

### Safety

Document text is untrusted input; system prompts are fixed and versioned; document content
is framed as data, not instructions. Prompt-injection fixtures in CI. Model responses are
never executed, never rendered as HTML, never used to build SQL. Where a capability is not
built yet, the UI shows an explicit architecture boundary — not a fake progress animation.

## Consequences

- **Positive:** legible, auditable AI; provider-swappable; per-capability versioning and
  cost/quality attribution; a hard human gate before trusted data; reproducible pipeline
  with a persisted parsed artifact.
- **Trade-offs accepted:** more moving parts than one endpoint; human review is a
  throughput constraint by design; prompt-version discipline required; deterministic
  pre-processing must be maintained per file type.
- **Commits us to:** the `candidate_datapoint` gate; `AIJob` recording before any output is
  used; versioned prompt files with a changelog; Zod schemas for every structured output;
  a retrieval layer for Ask TRACE before any generation.

## Revisit when

- EU data-residency / provider terms make Claude unsuitable for customer data → execute the
  `AIProvider` swap (prompts and schemas are provider-neutral).
- Extraction volume makes synchronous human review the bottleneck → add deterministic
  auto-validators for narrow, well-characterised document types (still not "AI verified").
- A capability needs its own service for scaling → extract it via `apps/worker` (ADR-002).
