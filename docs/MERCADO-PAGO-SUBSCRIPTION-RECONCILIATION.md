# Mercado Pago recurring subscription reconciliation

`billing-webhook` remains the low-latency path for one-time payments and for recurring events when Mercado Pago delivers them. Subscription lifecycle must not rely on the application-wide Webhooks URL: Mercado Pago's current Webhooks documentation states that application-level configuration is unavailable for Subscriptions, while its topic reference lists `subscription_preapproval`, `subscription_authorized_payment`, and `payment`. The documented API exposes `GET /preapproval/{id}`, `GET /authorized_payments/search?preapproval_id=...`, `GET /authorized_payments/{id}`, and `GET /v1/payments/{id}`. The `/preapproval` create contract in use by this repository does not document a `notification_url`; do not invent one.

The new `billing-subscription-reconcile` Edge Function polls only persisted F7 subscription IDs. It verifies the token's MLB test/production identity, matches the provider seller (`collector_id`) against `/users/me`, checks the subscription's external reference and immutable amount/currency snapshot, checks each invoice's `preapproval_id`, then queries each underlying payment and verifies seller, amount, currency, and status before calling the existing service-only idempotent settlement RPC. It never creates, charges, pauses, resumes, or cancels a provider subscription. Provider failures leave the lease available for bounded exponential retry; the SQL claim RPC uses `FOR UPDATE SKIP LOCKED` and a short lease to prevent overlapping workers. Deterministic reconciliation event keys and the existing provider-payment unique key prevent duplicate settlements.

## Fail-closed configuration

- `BILLING_RECONCILIATION_ENABLED=false` or unset: no reconciliation.
- `BILLING_RECONCILIATION_SECRET`: a dedicated random secret used only to authenticate the scheduled caller; it is not a Supabase service-role key.
- Existing `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_ENVIRONMENT`, and `MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED` gates still apply.
- `billing-subscription-reconcile` must be deployed with gateway JWT verification disabled; the handler requires the exact dedicated Bearer secret and does constant-time comparison.

## Supabase Cloud scheduling, after a separately approved rollout

Enable the supported `pg_cron`, `pg_net`, and Vault extensions in the candidate project's Dashboard. Save the Edge Function URL, a publishable API key, and the same dedicated reconciliation secret in Vault under `f7_billing_reconcile_url`, `f7_billing_publishable_key`, and `f7_billing_reconcile_secret`. Set the Edge Function secret `BILLING_RECONCILIATION_SECRET` to that same random value. Do not store service-role credentials in Vault for this job.

Create a five-minute job in Supabase Cron (or SQL Editor) using the documented `pg_cron` + `pg_net` + Vault pattern:

```sql
select cron.schedule(
  'f7-billing-subscription-reconcile',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'f7_billing_reconcile_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'f7_billing_publishable_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'f7_billing_reconcile_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
```

Run the cron job initially with the function gate disabled, verify only that the scheduled call is rejected as disabled, then enable the function only in the intended environment after credentials, migration, function, and operational monitoring are ready. A future production rollout must keep `MERCADO_PAGO_PRODUCTION_PAYMENTS_ENABLED=false` until separately approved; AI-credit packs have their own `MERCADO_PAGO_AI_CREDITS_ENABLED` gate and remain disabled.

## Limits of sandbox evidence

The automated poll and its idempotent settlement can be covered with provider mocks in local tests. A complete recurring renewal still depends on Mercado Pago's sandbox generating a later authorized invoice for a subscription. If the sandbox does not advance a billing cycle, that real renewal cannot be proven by accelerating local time or fabricating provider status; report it as externally unverified. A one-time Orders PIX approval does not prove recurring subscription renewal.

## Rollback

First unschedule `f7-billing-subscription-reconcile` and set `BILLING_RECONCILIATION_ENABLED=false`. Keep existing billing and payment rows. After any active lease expires, code can be rolled back while retaining the additive reconciliation columns, or the rollback described in migration `20261019200000_billing_subscription_reconciliation.sql` can be applied only after confirming no worker remains. Never delete billing events or payments as part of rollback.
