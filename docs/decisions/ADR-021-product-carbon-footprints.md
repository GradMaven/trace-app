# ADR-021: Product carbon footprints

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 14b

## Context

The second Phase-14 slice: **product carbon footprints (PCF)** — the cradle-to-gate
GHG emissions per functional unit of a product the organization makes or sells,
built from a bill of materials. It reuses the Phase-4 carbon engine for unit-aware
factor conversion, the Phase-11 supplier comparison for spend-based lines, and a
recursive PCF lookup for sub-assemblies. A network-wide scenario engine and
cross-tenant benchmarking remain deferred.

## Options considered

### Line emission sources

A BOM line's emission value can come from four places — modelled as a
`PcfLineSource`:

- **`factor`** — an org or library `emission_factor` (the common case; unit-aware
  via `computeEmission`).
- **`supplier`** — a linked supplier's carbon intensity (spend-based; the line
  quantity is spend in €).
- **`sub_product`** — another product's latest PCF (a sub-assembly; recursive).
- **`manual`** — a declared "kg CO2e per unit of the line".

Each line also carries an explicit `dataTier` (`primary` / `secondary` /
`estimated`) that drives the data-quality grade; for a `factor` line left at the
default, the tier is inferred from the factor's methodology
(`supplier_specific` → primary, `spend_based` → estimated, else secondary).

### Where the maths live

- **`@trace/domain/network/pcf.ts`** (pure) takes lines **already resolved** to
  "kg CO2e per unit" and does only arithmetic: roll-up, the allocation factor,
  the by-line / by-kind breakdown, the primary-data share, the A–E grade, and a
  reproducible `inputsDigest`. It never touches the carbon engine's Decimal
  machinery or the database.
- **`@trace/db/pcf.ts`** does the resolution — one `computeEmission` call per
  factor line (a `UnitError` marks the line unresolved rather than failing the
  whole PCF), a single batched `supplierCarbonComparison` for supplier lines, and
  a `pcf_record` lookup for sub-product lines — then calls the domain function
  and persists the result.

### Allocation

- Kept simple: a single `allocationMethod` (`none` / `mass` / `economic` /
  `physical`) + an `allocationFactor` (0..1) applied to the subtotal, with a
  free-text note. Co-products are not modelled explicitly yet — the factor is the
  documented share assigned to this product. `computeProductFootprint` rejects a
  factor outside `[0, 1]` and warns when the method is `none` but the factor
  isn't 1.

### Data-quality grade

- Deterministic from the primary-data share of the subtotal: **A** ≥ 80 %,
  **B** ≥ 60 %, **C** ≥ 40 %, **D** ≥ 20 %, **E** < 20 %. No score, no weighting
  — the breakdown shows exactly which lines are primary.

### Storage

- `product` + `bom_line` are mutable config. `pcf_record` is **immutable and
  versioned** (like `calculation` / `carbon_graph_snapshot` / `supplier_passport`):
  recompute chains a new version via `supersedes_id` and stores the full domain
  `ProductFootprint` JSON + the `inputs_digest`. All three are **RLS FORCE**.

## Decision

- **`@trace/domain/network/pcf.ts`** (pure): `computeProductFootprint({
  functionalUnit, boundary, allocation, lines })` → `ProductFootprint`
  (`subtotalKgCo2e`, `totalKgCo2e`, `breakdown[]`, `byKind[]`,
  `primary/secondary/estimatedDataSharePct`, `dataQualityRating`,
  `unresolvedLines`, `warnings`, `inputsDigest`), `pcfDataTierForMethodology`,
  `PCF_LINE_KINDS` / `ALLOCATION_METHODS`, `PCF_METHOD_VERSION = 'pcf@1.0.0'`.
  8 unit tests.
- **`@trace/db/pcf.ts`**: `createProduct` / `updateProduct` / `archiveProduct` /
  `listProducts` / `productDetail`; `addBomLine` / `updateBomLine` /
  `deleteBomLine` (each validates the line's source ref belongs to the org);
  `computePcf(db, {organizationId, productId, reportingPeriod?, computedByUserId?})`
  — resolves every line, runs the domain function, persists a new `pcf_record`
  version, audits `pcf.computed`; `latestPcf` / `pcfByVersion` / `listPcfRecords`.
  New models `product` / `bom_line` / `pcf_record`; migrations `0041_pcf` +
  `0042_pcf_rls`.
- **`@trace/shared`**: new `product.read` / `product.manage` permissions
  (`product.read` in `READ_ONLY_SUSTAINABILITY`; both alongside `calculation.*`
  for sustainability_manager / esg_analyst; `organization_admin` has all).
- **`apps/api`**: `ProductsModule` / `ProductsController` — `GET` / `POST
/products`, `GET` / `PATCH` / `DELETE /products/:id`, `POST` / `PATCH` / `DELETE
/products/:id/bom[/:lineId]`, `POST /products/:id/pcf/compute`, `GET
/products/:id/pcf` (`?version=`) + `/pcf/history`.
- **`apps/web`**: Carbon → **Product Footprints** — the product list with each
  product's latest footprint + A–E rating + primary-data share, a new-product
  form, and a per-product editor (allocation, an inline BOM-line editor with a
  source-specific picker, a Compute action, the PCF breakdown — total per
  functional unit, by-kind bar, per-line table with `resolvedFrom` and warnings —
  and the version history).
- **Seed**: a demo "Hot-rolled steel coil" product with five BOM lines (factor,
  supplier and manual sources) + a computed v1 PCF.

## Consequences

- A sub-product line depends on that product having a computed PCF; if it doesn't,
  the line is unresolved (a warning) rather than an error — the parent PCF still
  computes.
- Circular sub-assemblies are blocked at the BOM-line level (a product cannot
  reference itself); a deeper cycle would surface as stale sub-PCF values, not a
  crash.
- The allocation model is a single factor; explicit co-product modelling, a
  cradle-to-grave boundary, and biogenic / land-use accounting are follow-ups.
- The network scenario engine and cross-tenant benchmarking are the remaining
  Phase-14 items.
