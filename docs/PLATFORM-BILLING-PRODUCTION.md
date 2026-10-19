# Mercado Pago production readiness

The official F7 PRO Business Supabase production project is `vwylnjmapixtzhryiutt`. Billing environment checks bind credentials to that project: it accepts only `MERCADO_PAGO_ENVIRONMENT=production`; every other Supabase project accepts only `test`. This prevents sandbox requests or events from reaching the production database and prevents live credentials from being used by Preview or homologation.

## Configuration and independent gates

- `MERCADO_PAGO_ENVIRONMENT`: `production` only in the official project.
- `MERCADO_PAGO_ACCESS_TOKEN`: production Access Token, server-side only.
- `MERCADO_PAGO_WEBHOOK_SECRET`: webhook signing secret for the same Mercado Pago application/environment.
- `MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED`: must remain `false` until the owner explicitly releases real charges.
- `BILLING_RECONCILIATION_ENABLED`: must remain `false` until the subscription reconciliation migration, function, secret and schedule have all been verified.
- `BILLING_RECONCILIATION_SECRET`: dedicated random credential for the scheduled reconciliation caller; never use the Supabase service-role key.
- `MERCADO_PAGO_AI_CREDITS_ENABLED`: independent gate for credit-pack sales; keep `false` while launching plan billing.
- Vercel Production requires `VITE_MERCADO_PAGO_PUBLIC_KEY`; it is public by design and is not a substitute for either server-side secret.

`billing-health` can make a read-only `GET /users/me` request to check the configured Access Token while payment creation remains gated. Its response exposes only readiness booleans and never returns the token, signing secret or seller identity. Checkout must reject before provider calls or billing writes while the production charge gate is `false`.

## Recurring plans

The production project already has the dual-model billing base migration `20261018180049`. Recurring production checkout must additionally fail closed until reconciliation is deployed and scheduled. The additive migration `20261019233757_billing_subscription_reconciliation.sql` adds bounded leases and two `service_role`-only RPCs; it preserves subscription and payment records. Deploy `billing-subscription-reconcile` with gateway JWT verification disabled (`verify_jwt=false`); the handler authenticates with the dedicated bearer secret and checks the provider seller, subscription reference and immutable terms, then queries authorized invoices and payments before settlement.

For a cloud schedule, enable the supported Supabase `pg_cron`, `pg_net` and Vault extensions. Store only the function URL, a publishable/anon key and the dedicated reconciliation secret in Vault. Schedule the POST at a bounded interval (the documented default is five minutes). First leave `BILLING_RECONCILIATION_ENABLED=false` and verify the scheduled caller receives `RECONCILIATION_DISABLED`; enable it only after the deployed function, migration and schedule are verified. Never put a service-role key into the scheduled request or Vault for this job.

The webhook is the low-latency path. The polling function is the recovery path because the current Mercado Pago Subscriptions setup does not rely on an invented `notification_url` on `/preapproval`. It does not create, charge, pause, resume or cancel provider subscriptions. A real later renewal still needs a provider-generated sandbox cycle or a controlled real transaction; mocks prove code paths, not external settlement.

## Cutover sequence

1. Review and merge only the approved billing code; deploy the migration before any function version that calls its RPCs.
2. Set the three Mercado Pago server secrets to the Production application's values and `MERCADO_PAGO_ENVIRONMENT=production`; keep both payment and reconciliation gates off.
3. Deploy `billing-health`, `billing-checkout`, `billing-webhook`, `billing-subscription-manage`, and `billing-subscription-reconcile`, preserving JWT settings: all require JWT except webhook and reconcile, which validate their own signatures/dedicated secret.
4. Configure the Supabase schedule and dedicated secret; confirm the reconciliation function is healthy while its gate remains off.
5. Confirm Vercel Production has the public key and rebuild the frontend. Check `billing-health` read-only credential validation and verify checkout is still blocked before any provider creation.
6. Only after a separate owner release, enable `BILLING_RECONCILIATION_ENABLED=true` for recurring plans and, separately, `MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED=true` for real plan charges. Keep `MERCADO_PAGO_AI_CREDITS_ENABLED=false` until AI-credit commerce is separately approved.
7. Run a specifically authorized low-value live transaction and verify webhook signature, provider state, seller, amount, currency, reference, idempotency and product activation before opening checkout to customers.

## Rollback

Immediately set both production gates to `false`; this stops new checkout and reconciliation while retaining customer records. Unschedule the reconciler if necessary. Keep billing subscriptions, payment events, webhook records and ledger history. The additive reconciliation columns can remain dormant; do not drop or erase financial records as a rollback.

## Evidence boundary

Management tools can confirm that environment variable names and targets exist, but encrypted Vercel values and Supabase Edge Function secret values are intentionally not read. Presence and validity of Supabase secrets must be checked through authenticated `billing-health` in the application. A readiness response is a read-only credential check, not evidence that a payment or recurring cycle has been tested.
