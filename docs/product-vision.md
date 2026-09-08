# Product Vision

## Thesis

European companies don't have an ESG **reporting** problem. They have an ESG **evidence**
problem. Reports are outputs; trustworthy, traceable data is the product.

TRACE is the infrastructure layer between ERP, procurement, suppliers, logistics,
sustainability teams, finance, compliance, auditors and regulatory reporting. It converts
fragmented information into a continuously traceable evidence system.

## The chain TRACE connects

```
Organization → Business Units → Facilities → Suppliers → Materials → Products →
Transactions → Activity Data → Emission Factors → Calculations → Evidence →
Verification → ESRS / ESG Requirements → Reports → Audit
```

## The explainability test

When TRACE displays `2,206.76 tCO2e`, a user can ask and get an answer, linked to records:

- Where did this number come from?
- Which supplier supplied the data?
- What document supports it?
- What activity data was used?
- Which emission factor and version?
- Which methodology?
- When was the data collected? Who changed it?
- What assumptions were made? Was it estimated?
- Has it been verified? Which disclosure does it support?

Data lineage and evidence provenance are the core of the architecture, not a feature bolted
on later.

## Principles

| # | Principle | Consequence |
| --- | --- | --- |
| 1 | Evidence before reporting | Evidence and data models are built before report generators. |
| 2 | Every number has lineage | Provenance is a required column; lineage edges are queryable. |
| 3 | Never hide uncertainty | `provenance` enum on every material datapoint; UI always shows it. |
| 4 | Human approval matters | AI writes candidates; humans promote. No silent compliance decisions. |
| 5 | Auditability is first-class | Append-only history; tamper-evident audit log; nothing destroyed. |
| 6 | Enterprise security from day one | Tenant isolation, RBAC, audit, encryption designed in Phase 1. |
| 7 | Regulatory logic is versioned | Compliance rules live in a versioned store, not in components. |
| 8 | Explainability | Every calculation is deterministic and reproducible from stored inputs. |
| 9 | Interoperability | Integration adapters behind a stable interface; REST + OpenAPI. |
| 10 | European enterprise reality | EUR, metric, EU formats, multi-entity, multi-country, GDPR-ready, i18n-ready. |

## Personas

| Persona | Primary needs |
| --- | --- |
| **Sustainability Manager** | Emissions overview, data collection, supplier engagement, evidence gaps, reporting, audit readiness. |
| **ESG / Compliance Officer** | Regulatory mapping, evidence, controls, disclosure status, compliance workflows. |
| **Procurement Manager** | Supplier sustainability profiles, comparisons, carbon intensity, risk, procurement scenarios. |
| **CFO** | Confidence in reported numbers, financial impact, risk, audit readiness, executive summaries. |
| **Auditor** | Evidence, lineage, methodology, source documents, immutable history, approvals, exceptions. |
| **Supplier** | Simple onboarding, questionnaire, document upload, emissions submission, passport, evidence sharing. |
| **Administrator** | Users, roles, permissions, organizations, integrations, configuration, audit logs. |

## Modules

- **A — Command Center**: executive overview. Answers *Where are we? What's wrong? What's
  important? What should I do?* Actionable over decorative.
- **B — Sustainability Evidence Graph**: the core IP. Navigable relationships across
  organizations, suppliers, facilities, products, materials, activities, transactions,
  emissions, factors, evidence, calculations, regulations, disclosures, verifications.
- **C — Supplier Intelligence**: supplier directory + **Supplier Passport** (identity,
  carbon, environmental, social, governance, evidence).
- **D — Supplier Portal**: invitation → profile → questionnaires → documents → emissions →
  activity/product carbon data → requests → missing-evidence view → review → approve
  sharing. Dramatically simpler than enterprise sustainability software.
- **E — Carbon Accounting Engine**: transparent, deterministic. Scope 1; Scope 2
  (location- and market-based); Scope 3 architecture for all GHG Protocol categories,
  prioritising 1, 4, 6, 7, 9.

## Signature UX patterns

- **Evidence DNA** — a visual lineage panel for any number: supplier → activity → factor →
  method → evidence → reporting period → confidence → verification.
- **TRACE Trust Score** — a documented 0–100 score per datapoint with an itemised
  breakdown; the model is configurable and explainable, never arbitrary.
- **Audit Simulation** — the system scans the org and lists critical issues / warnings /
  verified datapoints, each linking directly to the underlying object.
- **Ask TRACE** — natural-language analytics as retrieval over structured records +
  evidence; every factual answer links to TRACE records; no hallucination.
- **Carbon Procurement Simulator** — model supplier / material / transport / geography /
  energy changes and see projected emissions, cost delta and data confidence.

## North star

- A CFO opens TRACE and sees **87% sustainability readiness**.
- A sustainability manager sees **14 critical evidence gaps**.
- A procurement manager sees **18 suppliers account for 41% of Scope 3**.
- An analyst opens a number and sees its **Evidence DNA**.
- An auditor clicks the same number and sees the **complete calculation lineage**.
- A supplier receives **one request** and uploads **one document**, which TRACE converts
  into structured, reviewable sustainability intelligence.

## Explicitly out of scope (for now)

- Legal advice or a guarantee of regulatory compliance. TRACE supports professional
  judgement; it distinguishes *software calculation*, *regulatory mapping*, *user
  interpretation* and *legal advice*.
- Auto-verification of AI output.
- PDF as a source of truth — reports are generated from structured data.
