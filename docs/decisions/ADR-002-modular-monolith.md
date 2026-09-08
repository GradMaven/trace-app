# ADR-002: Modular monolith (not microservices)

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 0

## Context

TRACE has many bounded contexts (Identity, Supply Chain, Carbon, Evidence, Trust,
Compliance, Audit, Process, Integrations, AI Ops). The brief (§15) says: prefer a modular
monolith initially unless there is a compelling reason for microservices, and design so the
system can evolve into services later. The team is small and pre-PMF.

## Options considered

### Option A — Microservices from the start
One service per context, independent deploys, network boundaries.

- Pros: independent scaling and ownership; strong isolation.
- Cons: distributed-systems tax (network failures, partial deploys, data consistency across
  services, tracing, local dev friction) with no team to pay it; premature boundaries that
  will be wrong before PMF; slows the vertical slice, which is the whole near-term goal.

### Option B — Single-process monolith with informal structure
One app, folders by feature, no enforced boundaries.

- Pros: fastest to start.
- Cons: boundaries erode; domain logic leaks into controllers and UI (violates brief §16);
  extracting a service later becomes a rewrite.

### Option C — Modular monolith with enforced boundaries
One deployable API + one worker + one web app, sharing a monorepo. Bounded contexts are
NestJS modules; pure domain logic is an I/O-free package; dependency direction is enforced
by lint.

- Pros: monolith velocity and simple ops; real boundaries that make later extraction
  mechanical; pure `domain` package keeps calculations/scoring/compliance reproducible and
  unit-testable in isolation (Principles 8, 41).
- Cons: requires discipline (lint rules, repository layer) and some upfront structure.

## Decision

**Option C.** Deploy as `apps/api` + `apps/worker` + `apps/web`. Bounded contexts are
modules within `apps/api`/`apps/worker`. Shared, I/O-free logic lives in `packages/domain`;
persistence in `packages/db`; AI in `packages/ai`; compliance rules in
`packages/compliance`; contracts in `packages/shared`.

Dependency rule (lint-enforced):

```
web → shared, ui
api / worker → domain, db, ai, compliance, shared
domain → (nothing)
db / ai / compliance → shared
```

`domain` importing `db`, `api`, or `ui` fails CI.

## Consequences

- **Positive:** one migration path, one deploy, one trace context; local dev is `pnpm dev`;
  the vertical slice is unblocked; domain logic is provably pure and testable; service
  extraction later = move a module + stand up transport, not a rewrite.
- **Trade-offs accepted:** shared database and process means a bad deploy affects all
  contexts; contexts can't scale independently until extracted; boundary discipline relies
  on lint + review.
- **Commits us to:** the repository layer (no raw Prisma access outside `packages/db`);
  module-to-module calls through explicit service interfaces, not by reaching into another
  module's internals; domain events for cross-context reactions (e.g. calculation inserted
  → lineage projection updated → audit log written).

## Revisit when

- A context has a genuinely different scaling profile — most likely AI/document processing
  in `apps/worker` — extract it first; the queue is already the boundary.
- Team grows to multiple squads wanting independent deploy cadence for a context.
- A context needs a different datastore that shouldn't sit in the main cluster.
