# API

## Style

- **REST**, resource-oriented, **versioned** under `/api/v1`.
- **OpenAPI 3.1** generated from the NestJS decorators; published at `/api/v1/openapi.json`
  and rendered docs at `/api/v1/docs`.
- **JSON** request/response; `application/json`; UTF-8.
- The web app consumes the same handlers through a generated typed client — no separate
  private API.
- Programmatic access (Phase 13) uses `ApiKey` bearer tokens with a permission scope.

## Conventions

| Aspect | Rule |
| --- | --- |
| Auth | Session cookie (web) or `Authorization: Bearer <api_key>` (programmatic). |
| Tenant | Derived from the session/key, never from a request parameter. `X-Organization-Id` may select among a user's memberships; the server validates membership. |
| IDs | UUID (v7). Opaque to clients. |
| Timestamps | ISO 8601 UTC (`2026-09-08T10:30:00Z`). |
| Money | `{ "amount": "1840000.00", "currency": "EUR" }` as strings. |
| Quantities | `{ "value": "1283.000000", "unit": "t" }` as strings to preserve precision. |
| Pagination | Cursor: `?limit=50&cursor=...`; response `{ data: [...], nextCursor?: string }`. |
| Filtering | Explicit query params per resource; documented in OpenAPI. No arbitrary query DSL over HTTP. |
| Sorting | `?sort=field` / `?sort=-field`. |
| Idempotency | `Idempotency-Key` header on POSTs that create resources or jobs. |
| Rate limits | Per IP and per org/key; `429` with `Retry-After`. |
| Versioning | Breaking changes → `/api/v2`. Additive changes stay in `v1`. Deprecations announced via `Deprecation` + `Sunset` headers. |

## Error format

```json
{
  "error": {
    "code": "evidence.not_found",
    "message": "Evidence 0193f1c2-... was not found in this organization.",
    "requestId": "req_01J...",
    "details": []
  }
}
```

- HTTP status reflects the class (`400` validation, `401` unauth, `403` permission,
  `404` not found / cross-tenant, `409` conflict/state, `422` semantic, `429` rate,
  `5xx` server).
- Cross-tenant access returns `404`, never `403` (no existence disclosure).
- `code` is a stable, namespaced string. `requestId` matches logs and traces.
- Validation failures (`400`) list field errors in `details` from the Zod parse.

## Resource groups (target surface)

```
/api/v1/auth/*                 magic-link request/verify, session, mfa
/api/v1/organizations          create, read, update; membership management
/api/v1/users                  invite, list, deactivate (within org)
/api/v1/roles                  roles + permissions
/api/v1/suppliers              CRUD, relationships, invitation, passport
/api/v1/supplier-portal/*      supplier-facing: profile, questionnaires, uploads, submissions
/api/v1/facilities
/api/v1/products
/api/v1/materials
/api/v1/transactions
/api/v1/activity-data
/api/v1/emission-factors       read (catalog); import (admin)
/api/v1/calculations           create (enqueues), read, lineage, recompute
/api/v1/emissions              scope 1/2/3 rollups, by period/category/supplier
/api/v1/evidence               CRUD, lifecycle transitions, linking, versions
/api/v1/documents              upload (signed URL), metadata, processing status
/api/v1/candidate-datapoints   review queue: promote / reject
/api/v1/trust-scores           read + breakdown
/api/v1/data-quality           issues, anomalies
/api/v1/compliance             regulations, requirements, disclosures, mappings, gaps
/api/v1/disclosures            status per disclosure
/api/v1/audits                 readiness, findings, package, simulation
/api/v1/reports                generate (enqueues), status, download (signed URL)
/api/v1/ask                    Ask TRACE queries (retrieval-grounded, sourced answers)
/api/v1/workflows              instances, tasks
/api/v1/notifications
/api/v1/integrations           connectors, runs
/api/v1/jobs                   background job status
/api/v1/audit-log              append-only, read + verify hash chain
/api/v1/webhooks               subscriptions (Phase 13)
```

## Long-running operations

Operations that do real work (`calculations`, `reports`, `documents` processing,
`integrations` sync, bulk imports) return `202 Accepted` with a `job` resource:

```json
{ "job": { "id": "job_...", "state": "queued", "resource": "/api/v1/reports/rep_..." } }
```

Clients poll `/api/v1/jobs/{id}` or subscribe to a webhook. State:
`queued → processing → completed | failed | retrying`.

## Auditing

Every mutating request is recorded in `audit_log` with actor, action, resource, before/after
and `requestId`. `GET /api/v1/audit-log` supports filtering by resource and time and a
`verify` action that recomputes the hash chain.

## Non-goals for v1

- GraphQL surface (revisit if integrator demand appears).
- Public unauthenticated endpoints beyond health/openapi.
- Arbitrary server-side query languages over HTTP.
