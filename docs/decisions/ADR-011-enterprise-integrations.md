# ADR-011: Enterprise integrations — the `IntegrationAdapter` contract & CSV activity import

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 12

## Context

Every number in TRACE starts as an activity-data row (Phase 4). Until now those rows arrive
only one at a time through the API / UI. The roadmap DoD for Phase 12: _an analyst brings a
year of facility energy in from a spreadsheet in one pass, sees per-row validation before
anything is written, and every imported row keeps its lineage._ The brief's principles still
bind: evidence before reporting, **every number has lineage**, never hide uncertainty, no
fabricated data. An import is a bulk mutation of the most load-bearing table in the product,
so it has to be as auditable and as tenant-isolated as a hand-entered datapoint — and it
must be impossible to half-commit a file without seeing what will land.

## Options considered

### Where the parse / map / validate logic lives

- **A1 — In the API controller / a service.** Rejected: it is pure, table-shaped logic that
  needs unit tests without a DB, and it will be reused by future adapters (SFTP drop, ERP
  pull) and by the seed.
- **A2 — A pure `@trace/domain/integrations` module** with a dependency-free delimited-text
  parser (`parseDelimited` — RFC-4180-ish: quoted fields, `""` escape, embedded
  delimiters/newlines, CRLF/LF, BOM strip) and an `IntegrationAdapter` interface
  (`targetFields()`, `sampleHeaders()`, `preview(input)` — no I/O). The CSV adapter
  (`csv_activity`) maps columns → the activity-data shape and validates every row
  (required-missing, non-numeric/negative quantity, bad enum, bad `YYYY-MM-DD` date,
  unit not in the TRACE unit registry, non-UUID subject/supplier id).
  - **Chosen.** `db → domain` already; the orchestrator just runs the adapter and writes rows.

### Preview vs commit

- **B1 — One endpoint that parses and writes.** Rejected: violates "never hide uncertainty" —
  the user must see the invalid rows and the exact typed values before committing.
- **B2 — `preview` (pure, no transaction) and `commit` (tenant transaction).** `preview`
  returns every row with its `raw`, its typed `mapped` (or `null`), and its `errors[]`, plus
  a `{ total, valid, invalid }` summary. `commit` re-runs the same preview server-side (the
  file is re-uploaded, checksum recorded), writes **only** the valid rows, and records an
  `integration_run`.
  - **Chosen.**

### Lineage of an imported row

- Each imported `activity_data` row is stamped `source_ref = import:<run>:<line>` so it
  traces back to the exact file line, and `provenance` comes from the mapped column or
  falls back to **`estimated`** (honest default — a spreadsheet cell is not a measurement).
  The `integration_run` stores the mapping, the defaults, the first 200 preview rows, the
  per-row commit errors, `createdActivityIds[]`, the file name + SHA-256, and timings.

### Failure semantics

- A run is `failed` only when it produced **zero** rows despite having valid ones (a
  systemic write failure); a run with some rows written and some per-row errors is
  `completed` with a non-empty `errors[]`. Invalid rows are never an error — they are the
  expected output of validation.

### Saved connectors

- `integration` rows hold a reusable `{ kind, name, config }` (config carries a saved
  mapping + defaults). A connector is optional — an import runs fine without one — and a
  committed run bumps the connector's `lastRunAt`. REST / SFTP / ERP adapters implement the
  same interface later; the schema does not change for them.

### What Phase 12 is **not**

- No scheduled / unattended pulls, no outbound sync, no credential vault, no binary formats
  (XLSX). Those need a real target system and are later. The importer rejects non-text
  uploads (NUL byte in the first 8 KB) and caps the file at 5 MB.

## Decision

- **`@trace/domain/integrations`**: `parseDelimited` / `detectDelimiter` (`csv.ts`), the
  `IntegrationAdapter` contract + preview types (`adapter.ts`), `CsvActivityAdapter`
  (`csv-activity.ts`), and a `registry.ts` (`getIntegrationAdapter` / `listIntegrationAdapters`).
  Pure; 13 unit tests.
- **`@trace/db/integrations.ts`**: `previewImport(kind, text, mapping, defaults)` (wraps the
  adapter, no transaction) and `commitImport(db, args)` (re-previews, creates the
  `integration_run`, writes one `activity_data` per valid row with `source_ref` +
  `provenance` fallback, per-row try/catch → `rowErrors[]`, updates the run + the
  connector's `lastRunAt`, writes one `integration.import_completed` audit entry).
  `createIntegration` / `updateIntegration` / `listIntegrations` /
  `listIntegrationRuns` / `integrationRunById`. New models `Integration` /
  `IntegrationRun` + enums `IntegrationStatus` / `IntegrationRunStatus`; migrations
  `0021_integrations` + `0022_integrations_rls` (RLS `FORCE` on both tables).
- **`apps/api`**: `IntegrationsModule` — `GET /integrations/adapters`, `GET /integrations`,
  `POST /integrations`, `PATCH /integrations/:id`, `POST /integrations/imports/preview`
  (multipart, no transaction), `POST /integrations/imports/commit` (multipart, SHA-256,
  `withOrgContext` → `commitImport`), `GET /integrations/runs(/:id)`. Reads need
  `activity.read`; configuring a connector and running an import need the new
  `integration.manage` permission (sustainability_manager, esg_analyst). 5 MB / text-only
  upload guard in the controller.
- **`apps/web`**: Settings → Integrations (saved connectors + import-run history) and an
  Import wizard (upload → auto-map columns → edit mapping / defaults → per-row preview with
  a valid/invalid summary → import the valid rows). Nothing is written until "Import".
- **Seed**: `seedIntegrations()` saves a "Monthly facility energy — CSV" connector and
  commits a 3-row FY2025 facility electricity/gas CSV for the demo org via `commitImport`,
  so the demo has real imported rows with `source_ref = import:<run>:<line>`.

## Consequences

- Imported rows default to `estimated` provenance and therefore score lower on Trust and
  show up in data-quality / audit-readiness scans until an analyst attaches evidence or
  maps a stronger provenance — the intended pressure, consistent with Phase 6–8.
- The seeded FY2025 inventory grows by the imported facility-energy rows; the Scope 2 figure
  in the demo now has a bulk-import origin visible in its lineage.
- `commit` re-parses the file rather than trusting the client's preview, so a preview and a
  commit of the same bytes always agree; the cost is the file is uploaded twice.
- One audit entry per run (not per row); the per-row detail lives on the `integration_run`.
- XLSX, scheduled pulls, and outbound adapters are explicitly deferred; the
  `IntegrationAdapter` interface is the seam they will implement.
