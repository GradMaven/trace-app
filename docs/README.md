# TRACE Documentation

Documentation reflects the **actual** implementation. When code and docs disagree, that is a
bug in one of them — fix it in the same change (Principle 46).

## Read in this order

1. [product-vision.md](product-vision.md) — thesis, principles, personas, modules, north star.
2. [architecture.md](architecture.md) — layers, monorepo, module boundaries, cross-cutting concerns.
3. [domain-model.md](domain-model.md) — aggregates, the lineage spine, state machines, Trust Score model.
4. [data-model.md](data-model.md) — tables, keys, indexes, versioning, RLS, provenance, GDPR lifecycle.
5. [api.md](api.md) — REST conventions, versioning, resource surface, errors, OpenAPI.
6. [security.md](security.md) — threat model, controls, tenant isolation, data inventory, test suite.
7. [ai-architecture.md](ai-architecture.md) — capabilities, provider abstraction, human-in-the-loop, AIJob.
8. [compliance-architecture.md](compliance-architecture.md) — versioned rule store, ESRS-first mapping engine.
9. [design-system.md](design-system.md) — design language, tokens, components, signature UX patterns.
10. [roadmap.md](roadmap.md) — 14 phases, the vertical slice, per-phase workflow, quality bar.

## Decisions

[decisions/](decisions/) — Architecture Decision Records. Start with the
[index](decisions/README.md).

## Also at repo root

- [`../TRACE-INITIAL-ENGINEERING-ASSESSMENT.md`](../TRACE-INITIAL-ENGINEERING-ASSESSMENT.md)
  — the founding assessment: current state, stack, architecture, roadmap, next steps,
  recorded assumptions.
- [`../README.md`](../README.md) — project overview and (from Phase 1) how to run it.
