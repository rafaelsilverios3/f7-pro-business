# F7 PRO + F7 FOOD product licensing assessment

Status: discovery and compatibility design. No production data or subscription records were changed.

## Current identity and billing boundaries

- F7 PRO identifies a tenant with `public.companies.id` and links its users through `public.company_users` (`company_id`, `user_id`). The user identity belongs to the PRO Supabase Auth project.
- F7 FOOD uses a different Supabase project, with `public.food_companies.id` and `public.food_company_users` linked to that project's own `auth.users`.
- The two company UUIDs and user UUIDs are project-local. Matching users by e-mail is not proof that they control both tenants; no automatic cross-project mapping is safe.
- The accessible PRO project in the connected Supabase account is named `f7-pro-business-homolog` (`vwylnjmapixtzhryiutt`). It is not evidence of the production database. The Food project is `esllvaacjlhtoxiznulb`.

## F7 PRO subscription behavior observed

- `company_subscriptions` has one row per company and is the legacy effective-plan source used by PRO gates. It cannot represent two independent product licenses for one company.
- The PRO plan catalog is in `plans` / `plan_features`. Those records already carry PRO-specific plan configuration. They must not be repurposed as Food pricing or overwritten to grant Food access.
- The effective entitlement path is `company_has_feature_internal` plus the public tenant-scoped `get_current_subscription` view. Both understand the separate `company_plan_grants` ledger.
- Manual plan grants have a platform-admin authorization check, required reason, start/end terms, revocation, and audit record. They affect PRO entitlement resolution, not Food.
- Billing uses `billing_checkout_sessions`, `billing_payments`, `billing_subscriptions`, and `billing_webhook_events`. Payment provider IDs and webhook event IDs have uniqueness constraints, and settlement is handled by atomic server-side RPCs. Existing code is scoped to the PRO plan model; adding a product must not silently send Food checkouts through PRO settlement.
- Existing PRO prices and contracts remain authoritative. No Food plan price is inferred from a PRO plan.

## F7 FOOD onboarding and access observed

- New Food companies are created by `food_create_company`; the caller becomes the first `admin` membership. The current authorization boundary is membership plus active-company status.
- The current stored roles are `admin`, `manager`, `operator`, `kitchen`, and `cashier`. Dedicated `waiter` and `expedition` roles and an invite/accept workflow are not present in the current schema/UI.
- Existing profile onboarding is a three-step establishment setup. It configures public profile, service modes, hours, delivery, and first products, but does not invite staff.
- Supabase Auth invitation/reset delivery has previously hit the project's email rate limit. Invitation work must use the existing Auth invite flow and must be tested against the configured SMTP before it is advertised as available; no credential or SMTP setting was read or changed here.

## Food `SECURITY DEFINER` review inventory

The live Food catalog contains 18 `public` SECURITY DEFINER RPCs flagged by the Supabase security advisor because authenticated users can execute them. Inventory checked each signature's grants, fixed `search_path`, session/tenant guards, and role guard. The operational RPCs are tenant-scoped through `food_private.company_has_access` and check an allowed role before mutation. `food_create_company` requires a signed-in user and creates only that caller's company and admin membership. `food_create_tab_order` relies on the tenant helper, which resolves the caller through `auth.uid()`. No anonymous execute grant was present on those 18 public RPCs.

`food_record_tab_payment` is currently not executable by `authenticated` in the live ACL (only `postgres` and `service_role`); the current UI does not call it. Re-enabling it as a shortcut would be unsafe. Three advisor INFO findings concern private internal tables for rate limiting/tracking with RLS enabled and no direct policies; they are intentionally not client-readable. They should remain private.

This is an access-surface review, not a claim that every operational edge case or every private trigger has been exhaustively penetration-tested. No grants were broadened and RLS was not changed.

## Compatible product-license design

1. Keep `company_subscriptions`, PRO `plans`, payment history, and `company_plan_grants` unchanged as the compatibility source for current PRO contracts.
2. Add a product-scoped entitlement model with a stable product key (`f7_pro`, `f7_food`), independent plan and dates, status, source, and immutable audit events. Do not mutate the PRO subscription when a Food license is bought, upgraded, suspended, or granted.
3. Backfill only PRO's existing subscription into the `f7_pro` product entitlement with the same plan/status/dates; compare counts and sample effective gates before switching any readers. Keep a rollback path and legacy fallback until parity is proven.
4. Keep Food operational entitlements in the Food project so Food RLS/RPCs can enforce them locally. A verified, signed, idempotent server-to-server provisioning event can later mirror a confirmed Food license. Do not expose either database's service key to a browser.
5. Link an optional PRO tenant and Food tenant only after an owner in each system proves control through a short-lived, one-use, authenticated pairing challenge. Store both project-local IDs and the audit actors. Never link by matching e-mail or company display name.
6. Keep product plan prices administrator-configurable and nullable until approved. Checkout creation remains disabled for new product keys until provider-side success, webhook signature verification, idempotency, refund/reversal, and license provisioning are homologated end to end.
7. Product-specific manual grants require a global admin authorization model in the system that owns the license, a reason, term, revocation, and audit trail. The PRO grant table cannot grant Food.

## Verification and rollout gate

Before implementation is enabled, tests must prove: PRO-only, Food-only, and dual-product access; independent plan changes and expiry; old PRO paid/manual grants unchanged; no cross-tenant link without both authenticated proofs; no anonymous or cross-company provisioning; webhook replay idempotency; payment confirmation as the only automatic activation source; manual-grant audit; and graceful access restoration after a temporary service failure.

Current blockers to a verifiable commercial flow: the authenticated Base44 connection for the existing storefront needs reauthentication; the PRO project surfaced by the Supabase connector is homologation rather than confirmed production; Food SMTP delivery has a known rate-limit issue; and the two projects have no verified tenant-pairing mechanism. Therefore no checkout, subscription migration, production entitlement gate, or storefront publishing is enabled by this assessment.
