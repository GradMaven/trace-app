# ADR-019: Billing-provider integration

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 13h (the last Phase-13 slice)

## Context

Phase 13c built the plan / quota engine (`plan` catalogue, per-org `subscription`,
`setPlan`, `checkQuota`) but had **no payment integration** — an admin switched
plans by hand. Phase 13h connects a real billing provider so plan changes are
driven by money.

Constraint (unchanged): there is **no live payment provider on this host**. So the
design keeps the offline-testable core honest — webhook signature verification,
event normalisation, and the event → subscription rule are pure functions — and
isolates the two provider network calls (checkout session, portal session) behind
an injected adapter that the CI test stubs. The real Stripe adapter is written
but only runs once an admin configures a live secret key.

## Options considered

### Provider shape

- **A1 — provider-neutral, webhook-only.** A generic signed-webhook endpoint that
  maps an external "plan changed" event onto `setPlan`, no checkout / portal.
  Smaller, but the upgrade flow stays entirely out-of-band.
- **A2 — Stripe-shaped adapter.** Model the de-facto standard: HMAC `t=,v1=`
  webhook signatures, a hosted checkout session + a customer portal, canonical
  event normalisation (`checkout.session.completed`,
  `customer.subscription.created/updated/deleted`, `invoice.payment_failed`).
  - **Chosen.** It's the realistic target and still fully offline-testable — we
    only implement *our* side plus signature verification; the adapter's network
    calls are injected.

### Webhook signature

- Reuses the Phase-13a outbound scheme: `t=<unix>,v1=<hmac-sha256(`<ts>.<body>`)>`
  over the **raw** request bytes, 300 s tolerance, constant-time compare. This is
  exactly Stripe's `Stripe-Signature` construction, under our own header
  `x-trace-billing-signature`. Verification needs the **plaintext** signing
  secret (HMAC, not a hash), so `billing_config.webhook_secret` is stored in the
  clear — same open item as `webhook_endpoint.secret` / `identity_provider.client_secret`
  (encrypt at rest in production). `main.ts` sets `rawBody: true` so
  `req.rawBody` carries the exact bytes.

### Applying an event

- `normalizeBillingEvent` maps a raw Stripe event object to a small canonical
  shape (`id`, `type`, `priceId`, `customerId`, `subscriptionId`, `sessionId`,
  `clientReferenceId`, `requestedPlanKey` from `metadata.trace_plan`,
  `providerStatus`). `billingEventOutcome(event, priceToPlan)` decides
  `{ planKey?, status? }`:
  - `checkout.completed` → the explicit `metadata.trace_plan` if set, else the
    mapped price, else no plan change yet (a subscription event follows);
    `status: active`.
  - `subscription.updated` → the mapped price's plan; `status` from the provider
    status (`active` / `past_due` / `canceled`); a `canceled` status falls the
    org back to the **free** plan.
  - `subscription.canceled` → free plan, `status: canceled`.
  - `invoice.payment_failed` → `status: past_due`, no plan change.
- `handleBillingWebhook` verifies the signature, parses + normalises, **dedupes**
  on `billing_event.provider_event_id` (globally unique → idempotent replays),
  then in `withOrgContext`: `ensureSubscription`, `setPlan` when `planKey` is set
  (the responsible actor for the audit entry is the config's creator), update
  `subscription.status`, record `customer_id` / `subscription_ref` on the config,
  complete any matching `billing_checkout`, write the `billing_event` row, and
  audit `billing.webhook_processed`.

### Data model

- `billing_config` (one per org — provider, `enabled`, `publishable_key`,
  `secret_key`, `webhook_secret`, `price_to_plan` JSON, `customer_id`,
  `subscription_ref`) → **RLS FORCE** (holds two plaintext secrets). The webhook
  handler resolves the org from the `:orgSlug` path, then opens `withOrgContext`.
- `billing_event` (idempotency ledger: `provider_event_id` unique, `type`,
  `status`, `outcome`) and `billing_checkout` (console-started attempts) are
  system-written logs carrying `organization_id`; **not RLS'd** (like
  `webhook_delivery`) so the worker can sweep stale checkouts cross-tenant.

### API surface

- `POST /billing/checkout` and `GET /billing/portal` are **session-authed**
  (`billing.manage`) and return a `{ url }` for the SPA to redirect to.
- `POST /billing/webhook/:orgSlug` is `@Public()` + `@MfaExempt()` (a provider
  callback carries no session) and reads `req.rawBody`.
- `GET` / `PUT` / `POST /webhook-secret` / `DELETE /settings/billing`
  (`billing.manage`). No new permission — `billing.manage` exists since 13c and
  `organization_admin` already holds it.

## Decision

- **`@trace/domain/access/billing.ts`** (pure): `signBillingPayload` /
  `verifyBillingSignature` (`t=,v1=`, 300 s), `generateBillingWebhookSecret`
  (`whsec_…`), `normalizeBillingEvent`, `resolvePlanForPrice` / `priceForPlan`,
  `billingEventOutcome`, `invalidPlanKeysInMap`, `BILLING_FALLBACK_PLAN`. 12
  unit tests.
- **`@trace/db/billing.ts`**: `upsertBillingConfig` (validates every mapped plan
  key; `secretKey` / `webhookSecret` fall back to stored; first enable mints a
  webhook secret and returns it once), `getBillingConfig` (never returns the
  secrets), `rotateBillingWebhookSecret`, `deleteBillingConfig`,
  `startCheckout(db, {adapter}, …)`, `billingPortalUrl(db, {adapter}, …)`,
  `handleBillingWebhook(prisma, …)`, `billingOverview`, `expireStaleCheckouts`.
  New models `billing_config` / `billing_event` / `billing_checkout`; migrations
  `0037_billing` + `0038_billing_rls` (RLS FORCE on `billing_config` only).
- **`apps/api`**: `BillingModule` — `BillingController`
  (`POST /billing/checkout`, `GET /billing/portal`, `POST /billing/webhook/:orgSlug`)
  and `BillingConfigController` (`/settings/billing`). `stripe-adapter.ts` — the
  real `fetch`-based `BillingProviderAdapter` (form-encoded, `Bearer` secret key,
  8 s timeout). `main.ts` gains `rawBody: true`.
- **`apps/worker`**: the housekeeping pass also runs `expireStaleCheckouts`.
- **`apps/web`**: Settings → **Billing** — the current plan + status, per-plan
  Upgrade buttons (→ checkout) and Manage billing (→ portal), the webhook URL +
  signing-secret issue/rotate, the provider config form, and a recent-events
  table.
- **Seed**: a **disabled** demo billing connection for the demo org with a
  `price → plan` map and no keys.

## Consequences

- Two plaintext secrets per org in `billing_config` (provider secret key +
  webhook signing secret) — the standing "encrypt config secrets at rest" item
  now covers billing too.
- The webhook handler is the only writer that calls `setPlan` without a real
  user actor; it attributes the audit entry to the config's creator.
- Refunds, proration, seat-based metering-to-invoice, tax, and multiple
  concurrent subscriptions are out of scope; the mapping is price → plan tier.
- **Phase 13 is complete.** The remaining roadmap is Phase 14 (Carbon Twin /
  network).
