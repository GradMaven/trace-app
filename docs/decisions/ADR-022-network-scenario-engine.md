# ADR-022: Network scenario engine

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 14c

## Context

The third Phase-14 slice: **what-ifs over the supply-chain carbon graph** built in
14a. An analyst applies a small set of interventions to the latest computed
graph and sees baseline → projected → delta, per node and overall, with the
change propagated up the tree the same way the real graph rolls up. The last
Phase-14 item — anonymized cross-tenant benchmarking — stays deferred.

## Options considered

### Where the maths run

- **A1 — a bespoke propagation routine.** Rejected: the 14a `buildCarbonGraph`
  already does DAG-safe, cycle-guarded roll-up. A scenario is just "mutate the
  node / edge inputs, then re-run the builder".
- **A2 — mutate the node / edge lists and re-invoke `buildCarbonGraph` +
  `rankHotspots`.** The projected graph is computed by exactly the same code as
  the baseline, so there is no risk of the two diverging.
  - **Chosen.**

### Interventions

Four kinds, each honest and offline-testable:

- **`decarbonize`** — cut a node's `directTco2e` by a percentage (0..100).
  Models a supplier commitment / an efficiency programme.
- **`substitute`** — set a node's `directTco2e` to a new absolute value (and mark
  its attribution `supplier_specific`). Models switching to a cleaner supplier.
- **`drop_node`** — remove a node and every edge touching it (the root cannot be
  dropped). Models eliminating or insourcing an input.
- **`reroute`** — repoint a declared edge `(from → currentTo)` at a new target
  node. Models re-sourcing an upstream tier.

An intervention whose target node / edge is not found is **skipped** with a
reason, not an error — a partially-applicable scenario still returns a result.

### Baseline reconstruction

`carbon_graph_snapshot` already stores the full domain `CarbonGraph`, whose nodes
carry every `CarbonNodeInput` field (`directTco2e`, `attribution`,
`annualSpendEur`, …) and whose edges carry `{from, to, relationship}`. The DB
layer strips a stored graph back to node / edge inputs and feeds them to
`applyNetworkScenario` — no re-query of suppliers / calculations, so a scenario
is reproducible against a specific historical snapshot version.

### Storage

- `network_scenario` is **immutable** (like `procurement_scenario` from Phase 11):
  it records `base_graph_version`, the interventions, and the full
  `NetworkScenarioResult`. RLS FORCE.

## Decision

- **`@trace/domain/network/scenario.ts`** (pure): `applyNetworkScenario({nodes,
  edges, rootId?, interventions})` → `NetworkScenarioResult` — deep-copies the
  inputs, applies each intervention, re-runs `buildCarbonGraph` + `rankHotspots`,
  and reports `baseline` / `projected` totals + hotspot counts, `deltaTco2e` /
  `deltaPct`, a per-node `nodeDeltas[]` (non-zero, sorted by |Δ|), and an
  `appliedInterventions[]` log (`ok` + `effect`). `NETWORK_SCENARIO_ENGINE_VERSION
  = 'network-scenario@1.0.0'`. 7 unit tests.
- **`@trace/db/network.ts`**: `previewNetworkScenario(db, {organizationId,
  baseGraphVersion?, interventions})` (loads the latest or a specific snapshot,
  reconstructs the inputs, runs the engine — no persist), `runNetworkScenario`
  (preview + persist a `network_scenario` + audit `network.scenario_run`),
  `listNetworkScenarios` / `networkScenarioById`. New model `network_scenario`;
  migrations `0043_network_scenario` + `0044_network_scenario_rls`.
- **`apps/api`**: `NetworkController` gains `POST /network/scenarios/preview`
  and `POST /network/scenarios` (`network.manage`), `GET /network/scenarios` and
  `GET /network/scenarios/:id` (`supplier.read`).
- **`apps/web`**: Supply Chain → **Network Scenarios** (linked from the Carbon
  Twin page) — an intervention builder (kind + node / edge pickers driven by the
  live graph), a Preview showing baseline → projected → delta + the per-node
  table + the applied-intervention log, a Save action, and the saved-scenario
  list (click to reload a saved projection).
- **Seed**: one saved scenario — a 25 % decarbonisation commitment for the
  demo tier-1 steel supplier.

## Consequences

- A scenario is pinned to a snapshot version, so recomputing the graph does not
  invalidate saved scenarios — they remain a faithful record of the analysis as
  it was run.
- `substitute` takes an absolute new value rather than modelling a replacement
  supplier's own graph; chaining scenarios or a supplier-vs-supplier compare is a
  follow-up.
- Cross-tenant benchmarking is the only remaining Phase-14 item.
