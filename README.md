# TRACE

**Sustainability Evidence & Supply-Chain Intelligence Platform**

> European companies don't have an ESG *reporting* problem. They have an ESG *evidence*
> problem.

TRACE turns fragmented supplier, operational, procurement, logistics and environmental
information into a continuously **traceable evidence system** that supports carbon
accounting, Scope 3 measurement, supplier collaboration, ESG reporting, regulatory mapping
and audit readiness.

Every material sustainability number in TRACE is explainable — back to the supplier, the
document, the activity data, the emission factor, the methodology, the reviewer and the
regulatory disclosure it supports.

**Every ESG number. Proven.**

---

## What this is / is not

| TRACE is | TRACE is not |
| --- | --- |
| Enterprise sustainability **evidence infrastructure** | A generic ESG dashboard |
| A data-lineage and provenance system | A CSRD report generator |
| A deterministic, reproducible carbon engine | A chatbot wrapped around an emissions calculator |
| Human-reviewed AI extraction | Auto-verified AI output |

## Project status

**Phase 15 — Regulatory-filing export (landed).** Turns the Phase-7 compliance data and the
Phase-8 audit chain into a structured regulator submission: an ESRS/CSRD-style disclosure
document, datapoint-by-datapoint, each figure carrying its lineage, trust score and evidence
refs, plus a completeness/gap report and a hard **"do not file" guard**. **New
`@trace/domain/compliance/filing.ts`** (pure) — `classifyFilingDatapoint` resolves each
required datapoint to `reported` / `flagged` / `gap` (a gap is no mapping, no value, trust
below the datapoint's floor, or no acceptable evidence; flagged is resolved-but-awaiting a
human); `assembleFiling` rolls those into a tree with `stats`, `gaps[]`, `blockers[]` and a
`readiness` that is `ready` **only** with zero gaps, zero flagged datapoints, **and** a
verifying audit-log chain; `renderFilingHtml` emits a deterministic `data-*`-tagged HTML
rendering (the seam for an iXBRL/ESEF pass) and never asserts "compliant". `@trace/db/filing.ts`
gathers the rule store + mappings + chain check, content-addresses the JSON and HTML to object
storage, and writes an immutable versioned `regulatory_filing` row + a `filing.generated`
audit entry. The API adds `GET /filings`, `POST /filings/generate`, `GET /filings/:id` and
`GET /filings/:id/download?format=json|html`; Web adds a Compliance → Regulatory Filings
screen (readiness banner, gap report, disclosure tree, JSON/HTML download). Builds, typechecks,
lints and unit tests are green; the Postgres-dependent integration suites (…, filing) run in
CI. See [docs/roadmap.md](docs/roadmap.md) and
[ADR-024](docs/decisions/ADR-024-regulatory-filing-export.md).

**Phase 14d — Cross-tenant benchmarking (landed).** The last Carbon Twin slice, and the one
feature that reads across tenants — reconciled with RLS isolation as follows. An org
self-declares a coarse **sector** and **opts in**; a platform job reads the opted-in orgs from
the (non-RLS) `organization` table and computes each one's **data-quality ratios**
(supplier-specific data share, evidence-backed share, PCF primary-data share) **through that
org's own tenant context** — nothing bypasses a policy. It writes **k-anonymized sector
buckets** to a global `benchmark_bucket` table that has no `organization_id`: a `(sector,
metric, period)` bucket stores no numbers at all until it has ≥ 5 contributors. **New
`@trace/domain/network/benchmark.ts`** (pure) — `computeBenchmarkBuckets` (grouping +
suppression + nearest-rank quartiles) and `compareToBenchmark` (ahead / in line / behind the
median). `@trace/db/benchmark.ts` adds the per-org settings, the contribution calc, the
`refreshBenchmarkBuckets` job, and `benchmarkComparison` (returns only the sector aggregate +
the caller's own value). New `benchmark_bucket` table and `organization.sector` /
`benchmark_opt_in`. The API adds `GET/PUT /network/benchmark/settings`, `GET
/network/benchmark`, and `POST /network/benchmark/refresh` (`platform.admin`); the worker
runs the refresh daily. Web adds a Supply Chain → Benchmark screen. Builds, typechecks, lints
and unit tests are green; the Postgres-dependent integration suites (…, benchmark) run in CI.
**Phase 14 (the Carbon Twin) is now feature-complete** — see [docs/roadmap.md](docs/roadmap.md).

**Phase 14c — Network scenario engine (landed).** The third Phase-14 slice: what-ifs over the
14a supply-chain carbon graph. **New `@trace/domain/network/scenario.ts`** (pure) —
`applyNetworkScenario` deep-copies the baseline node/edge inputs, applies a set of
interventions (**decarbonize** a node by a %, **substitute** its absolute direct emissions,
**drop** a node and its edges, or **reroute** a declared link), then re-runs the same
`buildCarbonGraph` + `rankHotspots` so the change propagates up the tree exactly the way the
real graph rolls up. It returns baseline → projected totals + hotspot counts, the overall
delta, a per-node delta table, and a log of what each intervention did (an unresolvable
target is skipped, not an error). `@trace/db/network.ts` adds `previewNetworkScenario`
(reconstructs the inputs from a stored snapshot — reproducible against a historical version),
`runNetworkScenario` (persists an immutable `network_scenario`), and the list / detail
readers. New `network_scenario` table. The API adds `POST /network/scenarios/preview` +
`POST /network/scenarios` (`network.manage`) and the two `supplier.read` reads. Web adds a
Supply Chain → Network Scenarios screen with a graph-driven intervention builder, a preview,
and the saved-scenario list. Builds, typechecks, lints and unit tests are green; the
Postgres-dependent integration suites (…, network-scenario) run in CI.

**Phase 14b — Product carbon footprints (landed).** The second Phase-14 slice: cradle-to-gate
**product carbon footprints (PCF)** from a bill of materials. **New
`@trace/domain/network/pcf.ts`** (pure) — `computeProductFootprint` takes BOM lines already
resolved to "kg CO2e per unit" and rolls up the footprint per functional unit, applies a
single allocation factor, breaks it down by line and by kind, and grades the data quality
**A–E** from the primary-data share, with a reproducible `inputsDigest`.
`@trace/db/pcf.ts` adds product + BOM CRUD and `computePcf`, which resolves each line —
a library / org emission factor via the Phase-4 carbon engine (unit-aware; a unit mismatch
just marks that line unresolved), a supplier's spend-based carbon intensity, another
product's PCF (a recursive sub-assembly), or a declared value — then persists an immutable
versioned `pcf_record`. New `product` / `bom_line` / `pcf_record` tables and `product.read` /
`product.manage` permissions. The API adds `/products` CRUD, `/products/:id/bom` editing, and
`POST /products/:id/pcf/compute` (+ history). Web adds a Carbon → Product Footprints screen —
the product list with each footprint + rating, a new-product form, and a per-product editor
with an inline BOM editor and the PCF breakdown. Builds, typechecks, lints and unit tests are
green; the Postgres-dependent integration suites (…, pcf) run in CI.

**Phase 14a — Carbon Twin: supply-chain graph (landed).** The first Phase-14 slice: a rolled-up
**supply-chain carbon graph** with an explainable **hotspot ranking**, on Postgres adjacency
(no graph database). **New `@trace/domain/network/graph.ts`** (pure) — `buildCarbonGraph`
rolls each supplier's attributed Scope 3 emissions up through tenant-declared upstream links
(DAG-safe: a shared upstream supplier is counted once; depth-capped and cycle-guarded), with
the organization's own Scope 1 & 2 at the root, and `rankHotspots` marks the smallest set of
suppliers that together drive ~80% of the footprint, each with plain-language reasons
(top contributor, above-median intensity, spend-based estimate, thin evidence, low Trust,
tier-1 without a passport). `@trace/db/network.ts` adds the declared-links CRUD, and
`computeCarbonGraph` — which gathers real suppliers, their emission datapoints, spend,
verified-evidence coverage and Trust, builds the graph, ranks the hotspots, and persists an
immutable versioned `carbon_graph_snapshot`; `carbonGraphNodeTrace` walks any node back to
the root and lists its backing calculations. New `supply_chain_edge` / `carbon_graph_snapshot`
tables and a `network.manage` permission (viewing needs only `supplier.read`). The API adds
`GET /network/graph` (+ history + per-node trace), `POST /network/graph/compute`, and
`GET/POST/DELETE /network/edges`. Web adds a Supply Chain → Carbon Twin screen — footprint
and coverage stats, a Pareto bar, the ranked hotspot table, a Recompute action, the
upstream-links editor, and a node-trace drawer. Builds, typechecks, lints and unit tests are
green; the Postgres-dependent integration suites (…, network) run in CI.

**Phase 13h — Billing provider (landed).** On top of Phase 13g, and the final Phase-13 slice:
a Stripe-shaped billing integration wired to the Phase-13c plan / quota engine. **New
`@trace/domain/access/billing.ts`** (pure) — `verifyBillingSignature` (the same
`t=<unix>,v1=<hmac-sha256>` scheme as outbound webhooks, 300 s tolerance, constant-time),
`normalizeBillingEvent` (raw Stripe event → a small canonical shape), and
`billingEventOutcome` (checkout / subscription / payment-failure event + the per-org
price→plan map → `{planKey?, status?}`; a cancellation falls the org back to the free plan).
`@trace/db/billing.ts` adds the per-org config CRUD (secret key + webhook signing secret
stored, never returned), `startCheckout` / `billingPortalUrl` (the two provider network calls
are an injected `BillingProviderAdapter`, stubbed in CI), and `handleBillingWebhook` —
verify the signature over the raw body, normalise, **dedupe on `billing_event.provider_event_id`**,
then `setPlan` + update `subscription.status` inside `withOrgContext`. New `billing_config` /
`billing_event` / `billing_checkout` tables. The API adds `POST /billing/checkout` +
`GET /billing/portal` (`billing.manage`) and `POST /billing/webhook/:orgSlug` (`@Public()`,
reads `req.rawBody`), plus `/settings/billing`; a real `fetch`-based Stripe adapter ships but
only runs with live keys. Web adds a Settings → Billing screen (current plan, Upgrade /
Manage billing, the webhook URL + signing secret, a recent-events table). Builds, typechecks,
lints and unit tests are green; the Postgres-dependent integration suites (…, billing) run in
CI. **Phase 13 is now feature-complete** — see [docs/roadmap.md](docs/roadmap.md).

**Phase 13g — SCIM 2.0 provisioning (landed).** On top of Phase 13f: TRACE is a SCIM 2.0
**service provider** — an identity provider pushes user and group lifecycle over a
bearer-token REST API instead of TRACE learning about people only at first sign-in. **New
`@trace/domain/access/scim.ts`** (pure) — the bearer-token generator + constant-time compare,
`parseScimUser` / `parseScimGroup`, `normalizeScimPatch` and the plain-model patch appliers
(`add` / `remove` / `replace`, `name.givenName`, the `members[value eq "id"]` selector), the
resource / list / error serialisers, an `attr eq "value"` filter parser, `count`-clamping
pagination, and `resolveScimRoleKeys` / `scimManagedRoleKeys`. `@trace/db/scim.ts` adds the
config CRUD + token rotation (only the sha256 is stored), `authenticateScim`, the SCIM
`User` / `Group` CRUD, and an internal `reconcileMemberRoles`: a SCIM user is the projection
of a `membership` (`active` mirrors suspended), a SCIM group grants roles through
`scim_config.group_role_mapping`, and the reconciler only ever touches the *managed set*
(default roles ∪ every mapped role) so hand-assigned roles are left alone. New `scim_config`
/ `scim_user` / `scim_group` / `scim_group_member` tables. The API adds `/scim/v2/:orgSlug`
Users / Groups / discovery controllers (bearer-authenticated, RFC 7644 error envelope,
`application/scim+json`) plus `GET/PUT/POST token/DELETE /settings/scim` (`security.manage`).
Web adds a Settings → SCIM Provisioning screen (base URL, token issue / rotate, the role
mapping, and a read-only list of provisioned users and groups). Builds, typechecks, lints and
unit tests are green; the Postgres-dependent integration suites (…, scim) run in CI.

**Phase 13f — SAML 2.0 SSO (landed).** On top of Phase 13e: per-organization SAML 2.0
Web-Browser-SSO with just-in-time provisioning. **New `@trace/domain/access/saml.ts`** (pure) —
the SP-initiated AuthnRequest + HTTP-Redirect binding (`SAMLResponse = base64(DEFLATE(xml))`),
SP metadata, and `verifySamlResponse`: XML Digital Signature verification via the vetted
`xml-crypto` / `@xmldom/xmldom` libraries (identity is read only from the bytes the library
reports as signed, which defeats signature-wrapping), plus every non-signature check —
exactly one assertion, each `<ds:Signature>` on the Response or that Assertion, RSA-SHA-256
only, `Issuer` / `Status` / bearer `SubjectConfirmationData` (`Recipient`, `InResponseTo`,
expiry) / `Conditions` window / `AudienceRestriction`. `@trace/db/saml.ts` adds
`upsertSamlProvider` / `getSamlProvider` / `deleteSamlProvider`, `beginSamlLogin` (persists a
single-use `saml_login_request` and returns the IdP redirect URL) and `completeSamlLogin`
(no injected I/O — the IdP posts the assertion straight to the ACS) which verifies the
assertion, enforces the email-domain allowlist, upserts the platform user, and JIT-creates a
membership with the roles from the attribute mapping inside `withOrgContext`. New
`saml_provider` / `saml_login_request` / `saml_link` tables. The API adds `GET
/auth/saml/:slug/{start,metadata}` and `POST /auth/saml/:slug/acs` (`@Public()`, errors
redirect to `/login?sso_error=`) and `GET/PUT/DELETE /settings/saml` (`security.manage`). Web
adds a protocol selector to the login SSO box and a Settings → SAML SSO config screen. Builds,
typechecks, lints and unit tests are green; the Postgres-dependent integration suites (…,
saml) run in CI.

**Phase 13e — OpenID Connect SSO (landed).** On top of Phase 13d: per-organization OIDC
sign-in with just-in-time provisioning. **New `@trace/domain/access/oidc.ts`** (pure) —
PKCE (`generatePkce` / `pkceChallengeFor`), the `state` / `nonce` tokens, the
authorization-URL builder, `verifyIdToken` (RS256-only: signature against the IdP's JWKS via
`crypto.createPublicKey({format:'jwk'})`, then `iss` / `aud` / `exp` / `nbf` / `sub` /
`nonce`), and `mapClaimsToRoleKeys` (default + email-domain + IdP-group → role keys).
`@trace/db/sso.ts` adds `upsertIdentityProvider` / `getIdentityProvider` (never returns the
secret) / `deleteIdentityProvider`, `beginSsoLogin` (persists a single-use
`sso_login_request` and returns the authorization URL), and `completeSsoLogin(prisma, deps,
…)` — token exchange and JWKS fetch are injected — which verifies the ID token, enforces the
email-domain allowlist, upserts the platform user, and JIT-creates a membership with the
mapped roles inside `withOrgContext`. New `identity_provider` / `sso_login_request` /
`sso_link` tables and `user.external_id`. The API adds `GET /auth/sso/:slug/{start,callback}`
(`@Public()`, errors redirect to `/login?sso_error=`) and `GET/PUT/DELETE /settings/sso` +
`POST /settings/sso/discover` (`security.manage`). Web adds a "Continue with SSO" box on the
login page and a Settings → Single Sign-On config screen. Builds, typechecks, lints and unit
tests are green; the Postgres-dependent integration suites (…, sso) run in CI.

**Phase 13d — Audit-log streaming + monitoring (landed).** On top of Phase 13c: push every
matching activity-log entry to a per-organization SIEM stream, plus operational monitoring.
**`@trace/domain/access`** gains (pure) `audit-stream.ts` (a stream filter + matcher, the
signed-batch envelope, a retry schedule), `prometheus.ts` (a Prometheus 0.0.4 text
serialiser), and `health.ts` (a health roll-up + heartbeat-age classifier). `@trace/db` adds
`audit-stream.ts` — stream CRUD plus `dispatchOrgAuditStreams`, which cursor-tails
`audit_log` per stream, filters, and POSTs a signed batch (the same HMAC scheme as webhooks)
with capped-backoff retry and auto-pause — and `ops.ts` (`orgStats`, `platformMetrics`). New
`audit_stream` / `audit_stream_delivery` / `component_heartbeat` tables. The API adds
`/settings/audit-streams/*` (`audit_stream.manage`), `GET /ops/stats` (`ops.read`), a
`METRICS_TOKEN`-gated `GET /metrics` (Prometheus text), and `GET /health/detailed`
(DB round-trip + worker heartbeat + storage driver, rolled up to healthy/degraded/unhealthy).
The worker runs a 20-second stream dispatch sweep and a 30-second heartbeat. Web adds
Settings → Audit Streams and Ops & Health. Builds, typechecks, lints and unit tests are
green; the Postgres-dependent integration suites (…, audit-stream) run in CI. SSO, SCIM and
a real billing provider are the only remaining Phase-13 items — see
[docs/roadmap.md](docs/roadmap.md).

**Phase 13c — Usage metering & quotas (landed).** On top of Phase 13b: per-organization
usage counters and plan-quota enforcement (no payment integration). **`@trace/domain/access`**
gains (pure) `metering.ts` — the metric catalogue (`api_request` / `ai_job` /
`calculation_run` / `export_job` / `seats`), plan tiers (free / growth / enterprise) with a
per-metric monthly quota and a soft-warn percentage, the `YYYY-MM` billing-period key, and
the `ok`/`warn`/`over` evaluation — and `audit-egress.ts` (a shape-guarded audit filter + an
NDJSON serialiser). `@trace/db` adds `metering.ts` (`recordUsage` — a period-counter upsert
plus a `usage_event` for the low-frequency metrics, and a `usage.threshold_reached` audit
entry on the soft-warn crossing that fans out to webhooks; `currentUsage`, `checkQuota`,
`setPlan`) and `queryAuditLog` / `exportAuditLog` (filtered, cursor-paged, NDJSON). New
`plan` (global catalogue), `subscription`, `usage_counter`, `usage_event` tables;
`provisionOrganization` now seeds the plan catalogue and a default subscription. The API
gains a fire-and-forget `UsageInterceptor` (counts every authenticated request plus the
`@Metered(metric)` routes) and a `QuotaGuard` that returns **`429 quota.exceeded`** for the
three enforced metrics; `GET /usage` + `PUT /usage/plan`; and, on `/audit-log`, filters plus
a new `GET /audit-log/export` (newline-delimited JSON, capped at 20 000 rows). The worker
rolls each subscription's billing period forward at the month boundary. Web adds Settings →
Usage & Plan and an action-prefix filter + NDJSON export on the Activity Log. Builds,
typechecks, lints and unit tests are green; the Postgres-dependent integration suites (…,
metering) run in CI. SSO, SCIM, audit-log *streaming*, and a billing provider remain open —
see [docs/roadmap.md](docs/roadmap.md).

**Phase 13b — Enterprise identity & governance (landed).** On top of Phase 13a: account
security and data governance. **`@trace/domain/access`** gains (pure) `totp.ts` (base32 +
RFC-6238 TOTP + a drift-tolerant verifier + `otpauth://` URI + single-use recovery codes),
`export-bundle.ts` (a 24-section export catalogue + manifest builder + 7-day TTL), and
`retention.ts` (retention targets — **operational / derived data only**, never evidence,
calculations, datapoints or the audit log — plus policy validation). `@trace/db` adds
`mfa.ts` (enrol → confirm → one-time recovery codes; challenge with a TOTP or a consumed
recovery code; disable; `resolveMfaRequirement` for the guard) and `governance.ts`
(`runExport` — reads every tenant section into a canonical-JSON bundle, SHA-256, uploads it
content-addressed, 7-day expiry; `runRetention` — `dry_run` counts, `apply` deletes, refused
while the org is under legal hold). New `user_mfa` (user-keyed, not RLS'd like `session`),
`export_job`, `retention_policy`, `retention_run` tables and `organization.require_mfa` /
`legal_hold`. The API `AuthGuard` gains an MFA gate (`403 auth.mfa_required` on every route
outside a small `@MfaExempt()` allowlist) with `POST /auth/mfa`, plus `/me/mfa/*`,
`/exports/*` (`data.export`, also held by auditor + finance), and `/settings/{security,
retention}/*` (`security.manage`). The worker runs an hourly retention **dry-run** sweep — it
never deletes on its own. Web adds an `/auth/mfa` challenge page (the app layout redirects an
unverified session there) and Settings → Security and Data & Retention. Builds, typechecks,
lints and unit tests are green; the Postgres-dependent integration suites (…, access,
governance) run in CI. SSO, SCIM, audit-log streaming and billing remain open under
Phase 13 — see [docs/roadmap.md](docs/roadmap.md).

**Phase 13a — Enterprise access (landed).** On top of Phases 1–12: programmatic access and
event fan-out. **New `@trace/domain/access`** (pure) — API-key format + SHA-256 hashing +
constant-time compare; coarse **scopes** (`read:all`, `activity:write`, …) that expand to a
permission set and can never include an admin or self-propagating permission; a webhook
**event catalog**, an audit-action → event map, HMAC `t=,v1=` signing, and a capped
exponential backoff schedule; `validateCustomRole`. `@trace/db` adds `access.ts`
(`createApiKey` / `authenticateApiKey` / …, webhook endpoint CRUD, and
`dispatchDueWebhookDeliveries(prisma, { fetch })` — sign, POST, record, reschedule, `dead`
after six tries, auto-disable an endpoint after fifteen straight failures) and, crucially,
`writeAuditLog` now **fans out**: a webhook-mapped mutation queues one `webhook_delivery`
per subscribed endpoint _in the same transaction_, so a delivery is never queued for a
change that rolls back. New `api_key` / `webhook_endpoint` / `webhook_delivery` tables and a
`role.is_system` flag; the API `AuthGuard` gains an `x-api-key` / `Bearer` path (CSRF-exempt,
capped permissions), plus `/api-keys` and `/webhooks` modules, custom-role CRUD, and
`PUT /members/:id/roles`. The worker dispatches due deliveries every 15s. Web adds Settings →
API Keys, Webhooks (with a delivery inspector), a custom-role editor, and an inline member
role editor. Builds, typechecks, lints and unit tests are green; the Postgres-dependent
integration suites (RLS / tenant isolation, supplier, evidence, carbon, AI extraction, trust,
compliance, audit, command center, ask, procurement, integrations, access) run in CI. SSO,
MFA, SCIM, export, retention and billing remain open under Phase 13 — see
[docs/roadmap.md](docs/roadmap.md).

**Phase 12 — Enterprise integrations (landed).** On top of Phases 1–11: bulk activity data
in, with per-row validation before anything is written. **New `@trace/domain/integrations`**
(pure) — a dependency-free CSV/TSV parser (`parseDelimited`), an `IntegrationAdapter`
contract, and `CsvActivityAdapter` (`csv_activity`) that maps a spreadsheet's columns onto
the TRACE activity-data shape and validates every row (missing required, non-numeric/negative
quantity, bad enum, bad date, unknown unit, non-UUID subject/supplier id). `@trace/db`
adds `previewImport` (pure — every row with its raw values, typed result or `null`, and
errors, plus a valid/invalid summary) and `commitImport` (writes **only** the valid rows as
`activity_data`, each stamped `source_ref = import:<run>:<line>` and defaulting to
`estimated` provenance, one audit entry per run), plus saved connectors and run history in
new `integration` / `integration_run` tables (RLS-forced). API exposes
`/integrations/*` behind a new `integration.manage` permission with a 5 MB text-only upload
guard; web adds Settings → Integrations and an import wizard (upload → auto-map → preview →
import — nothing is written until you confirm). Builds, typechecks, lints and unit tests are
green; the Postgres-dependent integration suites (RLS / tenant isolation, supplier, evidence,
carbon, AI extraction, trust, compliance, audit, command center, ask, procurement,
integrations) run in CI. See [docs/roadmap.md](docs/roadmap.md) for exact status and what's
next (Phase 13 — Enterprise readiness).

**Phase 11 — Procurement intelligence (landed).** On top of Phases 1–10:
`@trace/domain/procurement` — `compareSuppliers` (pure) ranks the supply base by **carbon
intensity** (tCO2e per €1,000 of annual spend), shows an `attributionQuality` per supplier
(spend-based EEIO screen, refined where supplier-specific calculations exist), and proposes
**deterministic**, quantified reduction opportunities; `projectScenario` (pure) re-runs the
Phase-4 carbon engine on a set of supplier lines with per-line changes (cut volume, switch
to a cleaner factor, drop a supplier) and reports baseline → projected → delta. `@trace/db`
gathers the tenant's suppliers + spend + attributed emissions + Trust + passports, and
persists **immutable** `procurement_scenario` snapshots (audit-logged). Web adds Supply
Chain → **Carbon Map** and a **Procurement Scenarios** builder. Builds, typechecks, lints
and unit tests are green; the Postgres-dependent integration suites (RLS / tenant isolation,
supplier, evidence, carbon, AI extraction, trust, compliance, audit, command center, ask,
procurement) run in CI. See [docs/roadmap.md](docs/roadmap.md) for exact status and what's
next (Phase 12 — Enterprise integrations).

**Phase 10 — Ask TRACE (landed).** On top of Phases 1–9: natural-language questions
answered by **retrieval over the tenant's own records** — the model never writes a query and
never answers a factual question about the workspace from outside knowledge. `@trace/ai`
gains the `nl_analytics` capability (two narrow, versioned calls: map the question to one of
11 fixed intents, then compose an answer **grounded only in a set of numbered records** and
say which it cited). `@trace/db` holds a catalog of hand-written, tenant-scoped retrievals
(emissions summary/trend, top Scope 3 categories, top suppliers, missing evidence, estimated
datapoints, outdated factors, low-Trust datapoints, compliance gaps, open findings,
data-quality issues); `runAskQuery` records **both model calls as `ai_job` rows** before
their output is used, and when retrieval returns nothing (or the intent is `unsupported`)
the answer says so and no second call is made. Every answer is stored as an `ask_query` row
with its citations (each a clickable UI link). Web adds `/ask` — a question box with example
prompts and answers that link to their sources. Builds, typechecks, lints and unit tests
are green; the Postgres-dependent integration suites (RLS / tenant isolation, supplier,
evidence, carbon, AI extraction, trust, compliance, audit, command center, ask) run in CI.
See [docs/roadmap.md](docs/roadmap.md) for exact status and what's next (Phase 11 —
Procurement intelligence).

**Phase 9 — Command Center (landed).** On top of Phases 1–8: one read-only aggregate,
`commandCenterOverview`, composes what the earlier phases already produce — the GHG
inventory and a multi-period trend, the data-provenance mix (and the primary-data share),
the Trust distribution, audit readiness and open findings, compliance progress and the top
gaps, supplier coverage, and recent activity — into a single payload behind
`GET /command-center/overview`. **Nothing is estimated for display**: every figure is read
straight from a model row or an existing engine, no writes, no new domain package. The
Command Center page is rebuilt on that endpoint with band-coloured gauges, an inline-SVG
emissions-trend sparkline, provenance and Trust stack-bars, and navigable lists of the top
compliance gaps and audit findings. Builds, typechecks, lints and unit tests are green; the
Postgres-dependent integration suites (RLS / tenant isolation, supplier, evidence, carbon,
AI extraction, trust, compliance, audit, command center) run in CI. See
[docs/roadmap.md](docs/roadmap.md) for exact status and what's next (Phase 10 — Ask TRACE).

**Phase 8 — Audit workspace (landed).** On top of Phases 1–7: `@trace/domain/audit` — a
documented additive **audit-readiness score** (`audit-readiness@1.0.0`, 0–100) over evidence
verification, calculation reproducibility and approval, data quality, Trust level,
compliance mapping and audit-trail integrity, with a per-dimension breakdown and itemised
issues that each point at their object. `@trace/db` adds `audit` engagements,
`audit_finding` (idempotent re-runs, auto-resolve, sticky *accepted risk* / *dismissed*),
`audit_simulation_run` and `audit_package` (RLS on all four). `runAuditSimulation` composes
`reproduceCalculation`, `verifyAuditChain`, the data-quality issues, Trust Scores and the
compliance mappings; `generateAuditPackage` assembles a canonical-JSON bundle — evidence +
verifications, calculations + steps + a live reproduce check, datapoints + lineage + Trust,
compliance mappings + gaps, open findings, and the audit-log chain verification — written
to object storage and content-addressed by its SHA-256. Web adds Audit → Readiness,
Findings, Evidence Review with a per-datapoint **evidence-chain walk** (disclosure →
datapoint → calculation → activity → factor → evidence), Controls, and Audit Package
(generate + download). Builds, typechecks, lints and unit tests are green; the
Postgres-dependent integration suites (RLS / tenant isolation, supplier, evidence, carbon,
AI extraction, trust, compliance, audit) run in CI. See [docs/roadmap.md](docs/roadmap.md)
for exact status and what's next (Phase 9 — Command Center).

*(Phase-by-phase notes for Phases 1–7 have been trimmed — see
[docs/roadmap.md](docs/roadmap.md) for the full per-phase status. In brief: **1** monorepo +
auth + RBAC + tenancy + hash-chained audit log; **2** supplier directory, portal and
versioned Supplier Passport; **3** evidence infrastructure — storage, the Evidence lifecycle
state machine, Datapoints; **4** the deterministic, reproducible carbon engine; **5** the
`@trace/ai` package — Claude adapter + dev stub, a human-gated document-extraction pipeline;
**6** the Trust Engine — Trust Score, data-quality checks, anomaly detection; **7** the
`@trace/compliance` package — a versioned ESRS rule store and a generic mapping engine that
never says "compliant".)*

Reference documents:

- [`TRACE-INITIAL-ENGINEERING-ASSESSMENT.md`](./TRACE-INITIAL-ENGINEERING-ASSESSMENT.md) —
  current state, stack, architecture, roadmap, next steps.
- [`docs/`](./docs) — product vision, architecture, domain model, data model, API,
  security, AI architecture, compliance architecture, design system, roadmap.
- [`docs/decisions/`](./docs/decisions) — Architecture Decision Records.

## Documentation map

| Document | Purpose |
| --- | --- |
| [docs/product-vision.md](docs/product-vision.md) | Thesis, principles, personas, modules, north star. |
| [docs/architecture.md](docs/architecture.md) | Layers, monorepo, module boundaries, cross-cutting concerns. |
| [docs/domain-model.md](docs/domain-model.md) | Aggregates, entities, the lineage spine, state machines. |
| [docs/data-model.md](docs/data-model.md) | Tables, keys, indexes, versioning, RLS, provenance. |
| [docs/api.md](docs/api.md) | REST conventions, versioning, resources, errors, OpenAPI. |
| [docs/security.md](docs/security.md) | Threat model, controls, tenant isolation, GDPR-ready data lifecycle. |
| [docs/ai-architecture.md](docs/ai-architecture.md) | Capabilities, provider abstraction, human-in-the-loop, AIJob record. |
| [docs/compliance-architecture.md](docs/compliance-architecture.md) | Versioned regulatory rule store, ESRS-first mapping model. |
| [docs/design-system.md](docs/design-system.md) | Design language, tokens, components, signature UX patterns. |
| [docs/roadmap.md](docs/roadmap.md) | 14 phases, the vertical slice, per-phase workflow. |

## Tech stack (summary)

TypeScript · Node 22 · pnpm + Turborepo · NestJS API · Next.js 15 web · PostgreSQL 16 (RLS)
· Prisma · BullMQ/Redis · S3-compatible storage (EU) · Anthropic Claude behind an
`AIProvider` interface · Zod · Vitest / Testcontainers / Playwright · OpenTelemetry / pino /
Sentry.

Rationale and rejected alternatives: [docs/decisions/ADR-001-technology-stack.md](docs/decisions/ADR-001-technology-stack.md).

## Repository layout (target)

```
apps/
  web/        Next.js 15 application shell + all persona surfaces
  api/        NestJS HTTP API (/api/v1), OpenAPI, auth, RBAC, audit
  worker/     BullMQ worker — document processing, extraction, calculation, reports
packages/
  domain/     Pure TS: calculation engine, unit conversion, Trust Score, quality rules
  db/         Prisma schema, migrations, seed, tenant-scoped repositories
  ai/         AIProvider interface, Claude adapter, versioned prompts, output schemas
  compliance/ Versioned regulatory rule store (ESRS first) + mapping evaluator
  shared/     Zod schemas, DTOs, units registry, error taxonomy
  ui/         Design-system components (Tailwind v4 + Radix), tokens, charts, graph views
  config/     Env schema, shared tsconfig/eslint/prettier, lint boundary rules
```

## Getting started

Prerequisites: **Node 22+**, **pnpm 9** (`npm i -g pnpm@9` if `corepack` can't install it),
and a **PostgreSQL 16** database + **Redis** — either via Docker or hosted (EU region).

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL (and REDIS_URL for the worker)
```

**With Docker:**

```bash
docker compose up -d          # Postgres + Redis; also creates trace_test
```

**Without Docker:** point `DATABASE_URL` / `DATABASE_URL_TEST` in `.env` at a hosted
Postgres (Neon, Supabase, Railway, …) and `REDIS_URL` at a hosted Redis (Upstash, …).

Then:

```bash
pnpm db:migrate               # prisma migrate deploy — schema + RLS + audit guard
pnpm db:seed                  # seeds the "NordWerk Manufacturing AG" demo tenant
pnpm dev                      # api (:4000), web (:3000), worker
```

Sign in at http://localhost:3000 as `anke.roth@nordwerk.example`; the magic-link URL is
printed in the API server log (`EMAIL_TRANSPORT=console`). API docs:
http://localhost:4000/api/v1/docs.

### Checks

```bash
pnpm lint         # single root ESLint pass (flat config, enforces module boundaries)
pnpm typecheck    # tsc --noEmit across every package
pnpm test:unit    # Vitest unit suites (no database needed)
pnpm build        # turbo build of all packages + apps
# integration (needs Postgres):
pnpm --filter @trace/db exec prisma migrate deploy
pnpm --filter @trace/db test:integration   # tenant isolation / RLS
```

## Principles (load-bearing)

1. Evidence before reporting.
2. Every number has lineage.
3. Never hide uncertainty (`measured | supplier_reported | calculated | estimated | modeled | inferred`).
4. Human approval gates consequential outputs.
5. Auditability is a first-class feature.
6. Enterprise security from day one.
7. Regulatory logic is versioned data, not code.
8. Explainability — every automated calculation is reproducible.
9. Interoperability — clean APIs and adapters.
10. Built for European enterprise reality.

## License

Proprietary — © TRACE. All rights reserved. (Placeholder; confirm before first external
contribution.)
