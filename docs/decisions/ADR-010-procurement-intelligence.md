# ADR-010: Procurement intelligence — comparison & what-if engine

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 11

## Context

Phase 11 gives a procurement manager a carbon view of the supply base: compare suppliers by
carbon intensity, see which attributions are weak, and model a switch / volume cut / cleaner
factor. The DoD (roadmap): _a procurement manager compares suppliers by carbon and models a
switch._ The brief lists "supplier recommendations" and "reduction opportunities" — these
must be **deterministic**, not the AI Recommendation capability (a later phase, Principle 4).

## Options considered

### Carbon attribution per supplier

- **A1 — Only count supplier-specific data.** Rejected: most of a supply base has no primary
  data on day one, so the comparison would be almost empty and useless.
- **A2 — Spend-based EEIO screening as the baseline, refined where supplier-specific data
  exists.** Every supplier with an annual spend and a currency-dimension emission factor
  gets an attributed Scope 3 figure; suppliers who have submitted primary data (a
  supplier-specific calculation) use that instead. Each row exposes its `attributionQuality`
  (`supplier_specific` | `spend_based` | `other` | `none`) so the weak ones are obvious.
  - **Chosen.** It mirrors real GHG Protocol Scope 3 practice (spend-based screen → refine
    hotspots) and it reuses the existing `emission_factor` library + `runCalculation`.

### Carbon intensity metric

- **`tCO2e per €1,000 of annual spend`** — comparable across categories and directly
  actionable in procurement. `null` when spend or emissions are unknown.

### Recommendations

- **B1 — LLM "what should we do?"** Deferred to the AI Recommendation phase.
- **B2 — A small set of deterministic, quantified rules** in `@trace/domain`:
  bring an above-median-intensity supplier to the set median (quantified saving); replace a
  spend-based estimate with supplier-specific data; onboard a material tier-1 supplier with
  no passport. Each carries a stated basis and (where possible) an indicative tCO2e.
  - **Chosen.**

### What-if scenarios

- **C1 — Re-select factors / re-run the whole inventory.** Too heavy and couples the
  hypothetical to stored data.
- **C2 — A pure `projectScenario(lines, changes)`** that re-runs `computeEmission` on a set
  of supplier lines (built from the suppliers' _current_ calculation inputs) with per-line
  changes (`activityMultiplier`, `factorValue`, `methodology`, `drop`), and reports
  baseline → projected → delta. It never mutates a stored `calculation`; a scenario the user
  saves is an immutable `procurement_scenario` snapshot.
  - **Chosen**, reusing the Phase 4 engine so a projection is as reproducible as a real
    calculation.

## Decision

- **`@trace/domain/procurement`**: `compareSuppliers` (`procurement@1` — intensity, shares,
  ranking, `attributionQuality`, flags, deterministic reduction opportunities) and
  `projectScenario` (re-runs `computeEmission`, exact via decimal.js). 13 unit tests.
- **`@trace/db/procurement.ts`**: `supplierCarbonComparison` (gathers suppliers + spend +
  attributed emission datapoints + methodology + Trust + passport → `compareSuppliers`),
  `scenarioLinesForSuppliers` (builds `ScenarioLineInput[]` from each supplier's largest
  attributed calculation), `runProcurementScenario` (persists an immutable
  `procurement_scenario`, audit-logged), `listProcurementScenarios` / `procurementScenarioById`.
  Model `procurement_scenario`; migrations `0019` + `0020` (RLS).
- **`apps/api`**: `ProcurementModule` — `GET /procurement/suppliers`,
  `POST /procurement/scenarios/lines`, `POST /procurement/scenarios`,
  `GET /procurement/scenarios(/:id)`. Reads need `supplier.read`; saving a scenario needs
  the new `procurement.scenario` permission (procurement_manager, sustainability_manager,
  esg_analyst).
- **`apps/web`**: Supply Chain → Carbon Map (ranked table + intensity bars + totals +
  reduction opportunities) and Procurement Scenarios (a builder: pick suppliers → default
  lines → per-line reduce % / new factor / drop → project & save; a saved-scenario detail).
- Seed: attributes a spend-based Scope 3 figure to every tier-1 supplier without primary
  data, then saves one demo scenario.

## Consequences

- Spend-based figures are coarse and usually overstate — that is the point (they flag where
  primary data is worth chasing), and every such row is labelled and appears in the
  opportunities list.
- Adding the spend-based lines raises the seeded FY2025 Scope 3 total; the trust and audit
  scans that run after it see the fuller, more realistic supply-base picture.
- Scenario lines are single-calculation per supplier (the largest attributed one); a
  supplier with several material calculations is a follow-up.
- No FX: a scenario keeps each line in its own currency/units, consistent with the carbon
  engine's no-currency-conversion rule.
