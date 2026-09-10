# ADR-023: Cross-tenant benchmarking

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 14d (the last Carbon Twin slice)

## Context

The final Phase-14 item: let an organisation compare its **data-quality ratios**
against an anonymised aggregate of its sector. This is the one feature that
deliberately reaches across tenants, so the design has to reconcile it with the
Phase-0 principle "RLS tenant isolation on every tenant table".

## Options considered

### Reading across tenants

- **A1 — a platform job under `withPlatformContext`.** Rejected: `current_org()`
  returns NULL under the platform context, so every RLS-`FORCE` policy
  (`organization_id = current_org()`) hides all rows — the platform context
  *cannot* read `carbon_graph_snapshot` / `pcf_record` at all.
- **A2 — iterate the opted-in orgs, each through its own `withOrgContext`.** The
  refresh job reads the (non-RLS) `organization` table for the orgs with
  `benchmark_opt_in = true`, then computes each one's contribution inside that
  org's own tenant transaction — exactly like the existing worker sweeps
  (`activeOrganizationIds` + per-org `withOrgContext`). No policy is bypassed.
  - **Chosen.**

### What is stored

- **No per-org benchmark values are ever persisted centrally.** The job computes
  each org's ratios on the fly, buckets them, and discards the raw list. The only
  persisted output is `benchmark_bucket` — a **global, non-tenant** table with no
  `organization_id` and no RLS, holding sector-level statistics.
- **k-anonymity.** A `(sector, metric, period)` bucket is written `suppressed`
  with **all statistics null** unless it has ≥ `BENCHMARK_K_ANON` (5)
  contributors. Below the threshold nothing numeric is stored, so a small sector
  cannot be probed.
- The read (`benchmarkComparison`) returns only the caller's sector bucket
  (median / p25 / p75 / min / max / n) plus the caller's *own* value (computed
  from the caller's own data in the caller's own context). It never performs a
  row-level cross-tenant read.

### Metrics

Three size-independent, higher-is-better ratios, all already computed elsewhere:

- `primary_data_share_pct` — the carbon graph's supplier-specific share
  (`carbon_graph_snapshot.attributed_pct`).
- `evidence_backed_pct` — the graph's direct-emissions-weighted verified-evidence
  share (`data.graph.totals.evidenceBackedPct`).
- `pcf_primary_data_share_pct` — the mean `primary_data_share_pct` across the
  org's latest PCF per product.

Absolute-footprint or intensity metrics were rejected for this slice: without a
revenue field they are noisy and easier to de-anonymise.

### Opt-in

- Two new `organization` columns: `sector` (a coarse self-declared value from
  `BENCHMARK_SECTORS`) and `benchmark_opt_in` (default `false`). An org must set a
  sector before it can opt in. Opting out removes it from the next refresh;
  already-published aggregates are not per-org so nothing needs deleting.

## Decision

- **`@trace/domain/network/benchmark.ts`** (pure): `BENCHMARK_K_ANON = 5`,
  `BENCHMARK_METRICS`, `BENCHMARK_SECTORS`. `computeBenchmarkBuckets(contributions,
  {period, kAnon?})` → `BenchmarkBucketStat[]` (nearest-rank p25 / median / p75,
  suppression below k). `compareToBenchmark(own, bucket, metric)` →
  `{standing: 'ahead' | 'in_line' | 'behind' | 'unknown', positionPct}`
  (±3 pts of the median is "in line"; unknown when the bucket is missing or
  suppressed). 8 unit tests.
- **`@trace/db/benchmark.ts`**: `getBenchmarkSettings` / `setBenchmarkSettings`
  (audit `benchmark.settings_updated`; opt-in requires a sector),
  `orgBenchmarkContribution(db, org)` (the three ratios from the org's latest
  snapshot + PCFs, or null), `refreshBenchmarkBuckets(prisma, {period?})` — the
  job: read opted-in orgs, per-org `withOrgContext` contribution, bucket, upsert
  `benchmark_bucket` on `(sector, metric, period)`; `benchmarkComparison(db, org)`
  — the read. `benchmarkPeriod(now)` → an ISO-week label. New `benchmark_bucket`
  model + `organization.sector` / `benchmark_opt_in`; migration `0045_benchmark`
  (no `_rls` pair — `benchmark_bucket` is global by design).
- **`apps/api`**: `NetworkController` gains `GET` / `PUT /network/benchmark/settings`
  (`network.manage`), `GET /network/benchmark` (`supplier.read`), and `POST
  /network/benchmark/refresh` (`platform.admin`).
- **`apps/worker`**: a daily `runBenchmarkRefresh` interval.
- **`apps/web`**: Supply Chain → **Benchmark** — a sector + opt-in control and a
  per-metric comparison (your value, the sector median tick, the p25–p75 band,
  your position marker; a "hidden — fewer than 5 contributors" note when
  suppressed).
- **Seed**: the demo org set to `sector: 'manufacturing'`, opted in; the refresh
  produces suppressed buckets (one contributor).

## Consequences

- The k-anonymity threshold (5) is a constant; making it configurable per sector
  or raising it for very small sectors is a follow-up.
- Sector is self-declared and unverified — a mis-declared org pollutes one
  bucket's statistics but reveals nothing.
- **Phase 14 (the Carbon Twin) is complete**: the supply-chain carbon graph +
  hotspots (14a), product carbon footprints (14b), the network scenario engine
  (14c), and cross-tenant benchmarking (14d).
