# Architecture Decision Records

Each ADR captures one consequential architectural decision: the context, the options
weighed, the decision, its consequences, and the signals that should make us revisit it.
Use [`ADR-000-template.md`](ADR-000-template.md) for new records. ADRs are immutable once
Accepted — supersede rather than edit.

| ADR | Title | Status |
| --- | --- | --- |
| [001](ADR-001-technology-stack.md) | Technology stack | Accepted |
| [002](ADR-002-modular-monolith.md) | Modular monolith (not microservices) | Accepted |
| [003](ADR-003-multi-tenancy.md) | Multi-tenancy strategy | Accepted |
| [004](ADR-004-evidence-lineage.md) | Evidence and data-lineage strategy | Accepted |
| [005](ADR-005-ai-architecture.md) | AI architecture | Accepted |

## Backlog (write when the phase reaches them)

- ADR-006 — Authentication & session model (magic-link now, SSO/SCIM path)
- ADR-007 — Background job design & idempotency (BullMQ)
- ADR-008 — File storage, signed URLs & malware scanning
- ADR-009 — Emission-factor dataset sourcing & licensing
- ADR-010 — Trust Score model governance & configurability
- ADR-011 — Compliance rule-store format & release process
- ADR-012 — Observability stack (OTel collector, log pipeline, PII scrubbing)
- ADR-013 — i18n / localisation approach
- ADR-014 — Graph store introduction (Phase 14 gate)
