# ADR-020: Carbon Twin — supply-chain carbon graph

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 14a

## Context

Phase 14 ("Carbon Twin / network") is a bundle: a supply-chain graph, carbon
hotspots, product carbon footprints, a network scenario engine, and cross-tenant
benchmarking. This ADR covers the **first coherent slice**: a rolled-up
**supply-chain carbon graph** with an explainable **hotspot ranking**. Product
carbon footprints and network benchmarking are deferred (a separate long-term
row).

The slice builds directly on what already exists: Phase 2 (suppliers +
relationship tier / spend), Phase 4 (calculations, the `emission` projection),
Phase 6 (Trust), Phase 11 (spend-based attribution). It adds no AI and needs no
external system.

## Options considered

### Graph storage

- **A1 — a graph database (Neo4j / Age).** Rejected for now: a single tenant's
  supply chain is shallow (root + suppliers + a few declared upstream tiers) and
  fits comfortably in Postgres adjacency with in-memory traversal. The roadmap
  note already says "a graph DB only if traversal needs justify it" — they don't
  yet.
- **A2 — Postgres adjacency + a computed snapshot.** A `supply_chain_edge` table
  for tenant-declared upstream links, and an immutable versioned
  `carbon_graph_snapshot` (like `supplier_passport` / `calculation`) holding the
  fully-computed `CarbonGraph` + `HotspotReport` JSON. Recompute chains a new
  version.
  - **Chosen.**

### Where the depth comes from — honesty

- The org → tier-1 edges are **derived** from real attribution (a supplier's
  emission datapoints for the period). Beyond tier 1 there is no data to infer
  structure from, so depth comes **only** from `supply_chain_edge` rows the
  tenant explicitly declares (manually, via import, or the passport
  questionnaire). A declared party with no known `supplier` row becomes a
  labelled stub node with **zero** direct emissions — structure without a
  fabricated number.

### Roll-up

- Every node's `upstreamTco2e` is the sum of its **unique** descendants' direct
  emissions — DAG-safe (a shared upstream supplier is counted once), depth-capped
  (`MAX_GRAPH_DEPTH = 8`), and cycle-guarded (a back-edge is dropped and
  recorded in `cycleWarnings`). The root's `directTco2e` is the organization's
  own Scope 1 + Scope 2 for the period (market-based Scope 2 preferred), so the
  snapshot's `totalTco2e` is a complete footprint, not just the upstream slice.
- An org → supplier edge is weighted by that supplier's **total** contribution
  (direct + rolled-up upstream); a declared supplier → supplier edge is weighted
  only when the upstream node itself carries carbon, else it is `kind: 'declared'`
  (structural).

### Hotspot ranking

- `rankHotspots` sorts the supplier nodes by `totalTco2e` and marks the smallest
  prefix whose cumulative share reaches `HOTSPOT_COVERAGE_TARGET` (0.8) as the
  hotspot set (classic Pareto / 80-20). Each node carries **explainable
  reasons**: top contributor, above-median carbon intensity (vs the set median,
  >1.25×), spend-based estimate / no attributed emissions, little or unknown
  verified evidence, low Trust Score, tier-1 supplier without a passport. No
  score — just the ranked list and the reasons.

### RLS

- `supply_chain_edge` and `carbon_graph_snapshot` are unambiguously tenant-owned
  → **RLS FORCE** on `current_org()`, like every other tenant data table.

## Decision

- **`@trace/domain/network/graph.ts`** (pure): `buildCarbonGraph(nodes, edges)` →
  `CarbonGraph` (rolled-up nodes, weighted edges, totals, `cycleWarnings`),
  `rankHotspots(graph, {coverageTarget?})` → `HotspotReport`, `tracePath(graph,
  nodeId)` → the shortest hop path from the root. `CARBON_GRAPH_BUILDER_VERSION =
  'carbon-graph@1.0.0'`. 7 unit tests (roll-up, diamond dependency not
  double-counted, cycle handling, attribution/evidence totals, Pareto cut +
  reasons, path tracing).
- **`@trace/db/network.ts`**: `listSupplyChainEdges` / `upsertSupplyChainEdge`
  (validates the buyer + upstream supplier belong to the org; a declared external
  party is stored as `to_label` only; audit `network.edge_added` / `_updated`) /
  `deleteSupplyChainEdge`. `computeCarbonGraph(db, {organizationId,
  reportingPeriod?, computedByUserId?})` — gathers active suppliers + their
  attributed emission datapoints (+ backing-calculation methodology for the
  attribution class), spend, verified-evidence coverage, min Trust, and the
  organization's own Scope 1 + 2; builds the node / edge lists (org → every
  active supplier, plus the declared links, plus stub nodes for external
  parties); runs the builder + hotspot ranking; persists a new
  `carbon_graph_snapshot` version; audit `network.graph_computed`.
  `latestCarbonGraph` / `carbonGraphByVersion` / `listCarbonGraphSnapshots` /
  `carbonGraphNodeTrace` (the path + the node's top backing calculations with
  their factor source and evidence count). New models `supply_chain_edge` /
  `carbon_graph_snapshot`; migrations `0039_carbon_graph` + `0040_carbon_graph_rls`.
- **`@trace/shared`**: a new `network.manage` permission (compute + edit edges),
  granted alongside `procurement.scenario` (sustainability_manager, esg_analyst,
  procurement_manager; `organization_admin` has all). Viewing the graph needs
  only `supplier.read`.
- **`apps/api`**: `NetworkModule` / `NetworkController` — `GET /network/graph`
  (`?version=`), `GET /network/graph/history`, `POST /network/graph/compute`
  (`network.manage`), `GET /network/graph/nodes/:nodeId/trace`, and
  `GET` / `POST` / `DELETE /network/edges`.
- **`apps/web`**: Supply Chain → **Carbon Twin** — the footprint / attribution /
  evidence / depth / hotspot-count stats, a Pareto bar, the ranked hotspot table
  (Pareto set highlighted, reasons as tags), a "Recompute" action, the declared
  upstream-links editor, and a node-trace drawer.
- **Seed**: three declared upstream links for the demo suppliers + a computed v1
  snapshot.

## Consequences

- The graph is only as deep as the tenant's declared links — the UI is explicit
  that tier-2+ structure is opt-in, and stub nodes carry no fabricated carbon.
- Snapshots are immutable and versioned; recompute is an explicit action (no
  timer — a carbon graph does not decay), so history is a real audit trail of how
  the picture changed.
- Product carbon footprints, a network-wide scenario engine, and anonymized
  cross-tenant benchmarking remain for a later Phase-14 slice.
