# Security

Security is a product surface, not a hardening pass (Principle 6, 19). This document is the
reference for controls; each phase includes a security review step (Principle 39, step 14).

## Assets & threat model (summary)

| Asset | Why it matters | Primary threats |
| --- | --- | --- |
| Tenant sustainability data & evidence | Confidential commercial + regulatory record | Cross-tenant access, broken object-level authz, insider misuse |
| Audit log & calculation history | Integrity is the product's value | Tampering, silent mutation, deletion |
| Uploaded documents | May contain PII, contracts, pricing | Malware, path traversal, unauthorized retrieval, SSRF on ingestion |
| Auth & sessions | Account takeover → everything | Phishing, session theft, CSRF, weak MFA |
| AI pipeline | Prompt injection via documents; cost abuse | Injected instructions in a PDF, data exfiltration via model, runaway spend |
| Secrets / keys | Provider + DB access | Leakage in logs, repo, or error messages |

## Identity & access

- **AuthN**: email **magic-link** for MVP (no password storage). Sessions are opaque,
  server-side, in `httpOnly; Secure; SameSite=Lax` cookies with short TTL + rotation.
  **TOTP MFA** is designed in (`session.mfa_passed`, `user.mfa_enabled`); enforced per org
  policy. `AuthProvider` abstraction reserves OIDC/SAML **SSO** and **SCIM** for Phase 13
  without domain changes.
- **AuthZ**: **permission-based RBAC**. Guards declare a required permission
  (`evidence.verify`, `calculation.approve`, `supplier.invite`, `audit.read`, …).
  Per-request permission set resolved from the actor's roles in the active organization.
  **Deny by default.**
- **Object-level checks**: every read/write validates `organization_id` **and** resource
  ownership/relationship. Automated tests assert that user A cannot touch org B's objects.
- **Least privilege**: Auditor and Supplier User roles are read-mostly / scope-limited by
  default.

## Tenant isolation

Defence in depth (see [ADR-003](decisions/ADR-003-multi-tenancy.md)):

1. Repository layer injects `organization_id` into every query and mutation; raw model
   access outside `packages/db` fails lint.
2. Postgres **Row-Level Security** on all tenant tables, keyed on a per-transaction
   `SET LOCAL app.current_org`.
3. CI security tests attempt cross-tenant reads/writes/file access and must fail closed.

## Input & output

- **Zod validation** at every API boundary; typed IDs; no mass-assignment (explicit DTO
  field lists).
- **SQL injection**: parameterised queries via Prisma only; no string-built SQL.
- **XSS**: React auto-escaping; no `dangerouslySetInnerHTML` without a sanitizer; strict
  CSP.
- **SSRF**: server-side outbound fetch (integration endpoints, `evidence.sourceUrl`
  ingestion) restricted by an allow-list and blocked from private/link-local ranges. No
  fetching arbitrary user-supplied URLs.
- **CSRF**: SameSite cookies + double-submit token for cookie-authenticated mutations.

## File handling

- Upload via **signed URL** to a private bucket; server never proxies raw bytes for large
  files.
- Validate **MIME by content sniffing** + extension allow-list; enforce size limits.
- Compute and store **sha256 checksum**; content-addressed dedupe.
- **Malware scan hook** in the processing pipeline before extraction; infected files are
  quarantined, not processed.
- Access only through **time-limited signed URLs**; storage keys are opaque and never
  exposed; no user-controlled paths.
- Retention metadata on every document; scheduled enforcement.

## AI safety

- Document-derived text is **untrusted input**. The extraction prompt treats document
  content as data, not instructions; system prompt is fixed and versioned; outputs are
  constrained to a Zod schema. Injected instructions in a document cannot change TRACE
  behaviour or trigger side effects.
- AI never writes trusted data: outputs land in `candidate_datapoint`; a permissioned human
  promotes them.
- Per-org **cost and rate ceilings** on AI calls; every call recorded as `ai_job` with
  tokens and cost.
- Model responses are never executed, rendered as HTML, or used to build queries.

## Auditability & integrity

- `audit_log` is **append-only** and **hash-chained**
  (`hash = sha256(prev_hash || canonical_json(entry))`). `UPDATE`/`DELETE` privileges on
  the table are revoked from the application role; a DB trigger also blocks them.
- A `verify` endpoint recomputes the chain and reports the first break.
- Lineage entities (`calculation`, `emission_factor` versions, `evidence` versions) are
  insert-only; supersession is explicit.

## Transport & headers

TLS 1.2+ everywhere; HSTS with preload; CSP (`default-src 'self'`, no inline script,
`frame-ancestors 'none'`); `X-Content-Type-Options: nosniff`; `Referrer-Policy:
strict-origin-when-cross-origin`; `Permissions-Policy` locked down.

## Secrets & supply chain

- Secrets from a managed store in deployment; `.env` git-ignored; pre-commit + CI secret
  scanning.
- **Never log**: passwords, magic-link tokens, session tokens, API keys, provider keys,
  full document contents, or PII beyond what an entry requires.
- Dependencies: `pnpm audit` + Renovate/Dependabot + CI SCA gate; lockfile committed;
  provenance for critical deps where available.

## Rate limiting & abuse

Per-IP and per-org/token limits on the API generally and auth endpoints specifically;
`Idempotency-Key` on resource-creating POSTs; job-queue backpressure; upload quotas.

## GDPR-ready data architecture

Not a compliance claim — an architecture posture (Principle 20).

| Principle | Mechanism |
| --- | --- |
| Data minimisation | Personal fields enumerated in a **data inventory**; only collected where a purpose is recorded. |
| Purpose limitation | Purpose tag per personal field; access paths documented. |
| Right to erasure | **Redaction workflow**: personal fields tombstoned; lineage skeleton + non-personal evidence retained; redaction logged. No hard delete of evidence/calculations. |
| Portability / access | Per-subject and per-organization structured **export** jobs. |
| Storage limitation | Retention policies + scheduled enforcement (`retention_until`). |
| Records of processing | Integration and AI processing recorded (`integration_run`, `ai_job`); sub-processor list maintained. |
| Localisation | EU-region storage and processing; provider DPAs. |
| Customer control | Org admins control member access and data export. |

## Data inventory (personal data — initial)

| Field | Location | Purpose | Erasure |
| --- | --- | --- | --- |
| `user.email`, `user.name` | platform | Authentication, attribution | Redact on account deletion; keep `actor_id` reference in `audit_log` with name tombstoned. |
| `session.ip`, `user_agent_hash` | platform | Session security | Auto-expire; short retention. |
| Supplier contact names/emails | `supplier_location`, questionnaires | Supplier engagement | Redact on request; retain company-level evidence. |
| Names in uploaded documents | `document` content, extracted text | Evidence | Document-level redaction; superseded version retained under legal-hold rules only. |

## Testing (Principle 41)

Security test suite in CI:

- Tenant isolation (cross-org read/write/file access) — must fail closed.
- Authorization matrix per role × permission.
- Object-level access (IDOR) probes.
- File access via stale/forged signed URLs.
- API abuse: rate limits, oversized payloads, malformed JSON, injection strings.
- Privilege escalation attempts (role/permission tampering, `X-Organization-Id` spoofing).
- AI prompt-injection fixtures (malicious instructions embedded in test documents).
