# ADR-024: Regulatory-filing export

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 15 (regulatory-filing export)

## Context

Phase 7 resolves each ESRS/CSRD required datapoint to a value + trust score +
evidence refs; Phase 8 produces a hash-chained, verifiable audit trail. Phase 15
turns that into the artefact a preparer actually hands to their assurance
provider: a structured disclosure document, datapoint-by-datapoint, each figure
carrying its lineage, plus a completeness/gap report and a hard "do not file"
guard when required datapoints are unverified.

The Phase-0 constraints bind here more than anywhere: **"TRACE never says
'compliant'"**, "evidence before reporting", "never hide uncertainty". The
document must describe what was *prepared* and what *gaps remain* — it must not
assert conformity.

## Options considered

### Where the assembly logic lives

- **A1 — build the document in the API/DB layer.** Rejected: the readiness
  classification (reported / flagged / gap) and the "do not file" rule are the
  regulatory-judgement core; they need exhaustive unit coverage and must be
  reproducible byte-for-byte.
- **A2 — a pure `@trace/domain` assembler fed resolved inputs.** `assembleFiling`
  takes already-resolved requirement → disclosure → datapoint inputs (value,
  trust, evidence, mapping status) and returns a `RegulatoryFiling` tree with
  rolled-up `stats`, `gaps[]`, `blockers[]`, `readiness`, and a
  `sha256(canonicalJson(body))` digest. `@trace/db` gathers the inputs (rule
  store, Phase-7 mappings, Phase-8 chain check) and content-addresses the output.
  - **Chosen.** Same split as the Phase-8 audit package.

### The "do not file" guard

- `classifyFilingDatapoint(rd)` → `reported | flagged | gap`:
  - **gap** — no mapping, no value, trust below the datapoint's `minTrustScore`,
    or no acceptable evidence (every linked evidence row is
    `rejected` / `expired` / `superseded`).
  - **flagged** — resolved with acceptable evidence but the mapping is
    `review_required` or not `confirmed` by a human.
  - **reported** — `mapping_complete`, confirmed, above trust, with evidence.
- `readiness` is `ready` **only** when there are zero gaps, zero flagged
  datapoints, **and** the audit-log chain verifies. Anything else →
  `blocked`, with every reason enumerated in `blockers[]`. The guard is
  structural: a caller cannot override it with a flag.

### Output formats

- **JSON** — `canonicalJson(filing)`, the machine-readable record.
- **Tagged HTML** — `renderFilingHtml(filing)`, deterministic, every datapoint
  wrapped in `data-*` attributes (`data-datapoint`, `data-metric`, `data-unit`,
  `data-trust`, `data-min-trust`, `data-resolution`, `data-value`,
  `data-evidence-*`, `data-lineage`), the structure an iXBRL tagging pass would
  consume. A full iXBRL/ESEF taxonomy binding is deliberately out of scope for
  this slice — the tagged HTML is the seam for it.
- Both artefacts are content-addressed to object storage under
  `filings/<org>/<digest>/filing.{json,html}` (`putBytes` injected, as in
  `generateAuditPackage`), so nothing here needs a live object store in CI.

### Persistence & versioning

- New `regulatory_filing` model (RLS `FORCE`): one immutable row per generate,
  `@@unique([organizationId, regulationKey, reportingPeriod, version])`, a
  `supersedesId` self-relation for the version chain. The row keeps a compact
  `summary` (stats / gaps / blockers / readiness) + storage pointers + the
  `sha256`; the full document lives in storage. Migrations `0046_regulatory_filing`
  + `0047_regulatory_filing_rls`.
- Every generate writes a `filing.generated` audit-log entry (regulation, period,
  version, readiness, gap count).

## Decision

- **`@trace/domain/compliance/filing.ts`** (pure): `FILING_FORMAT_VERSION =
  'esrs-filing@1.0.0'`, `FILING_DISCLAIMER`, `classifyFilingDatapoint`,
  `assembleFiling`, `renderFilingHtml`. 10 unit tests.
- **`@trace/db/filing.ts`**: `generateRegulatoryFiling(db, deps, args)` — loads
  the versioned rule store (throws `filing.rule_store_not_loaded` when the
  requested version is not present), the Phase-7 `complianceMapping` rows and
  their evidence, the disclosure status records, and `verifyAuditChain`; calls
  `assembleFiling` + `renderFilingHtml`; content-addresses both artefacts; writes
  the next `regulatory_filing` version + audit entry. Plus `listRegulatoryFilings`,
  `regulatoryFilingById`, `latestRegulatoryFiling`.
- **`apps/api`**: `FilingsController` — `GET /filings` (`compliance.read`),
  `POST /filings/generate` (`compliance.manage`), `GET /filings/:id`
  (`compliance.read`, returns the row + the stored document), `GET
  /filings/:id/download?format=json|html` (`compliance.read`, a 300 s signed URL).
- **`apps/web`**: Compliance → **Regulatory Filings** — a list with the
  readiness verdict + generate control, and a per-filing page: a
  ready/"do not file" banner with the blocker list, a gap report table, the
  disclosure tree with each datapoint's value / trust / evidence, the disclaimer,
  and JSON/HTML download buttons.
- **Seed**: one filing for the demo org's ESRS rule store, FY2025 — `blocked`
  (the demo compliance data has open gaps), an honest demo of the guard.

## Consequences

- The document is a **preparation aid**, never a compliance statement — the
  disclaimer says so, `renderFilingHtml` never emits "is compliant", and the
  readiness field is `ready`/`blocked`, not "compliant"/"non-compliant".
- iXBRL/ESEF taxonomy binding is a follow-up; the `data-*`-tagged HTML is the
  integration seam.
- A filing is a point-in-time snapshot: re-running compliance after a generate
  does not mutate an existing filing — the preparer generates a new version.
