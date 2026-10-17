# Mercado Livre notification worker

## Local implementation

`mercadolivre-webhook` still validates the provider source, application, seller, topic, entitlement and event id, then persists only a canonical resource pointer. After enqueue (including a duplicate delivery), it dispatches the private `mercadolivre-notification-worker` with `EdgeRuntime.waitUntil`. The HTTP response does not wait on the Mercado Livre API.

The worker requires both gateway JWT verification and an exact server-side service-role bearer match. It claims at most 20 due events, loads each connection by `(company_id, id)`, reuses encrypted token storage and refresh leasing, fetches the canonical resource from Mercado Livre, validates seller identity, and performs only company/connection-scoped idempotent upserts. It does not create F7 sales, change inventory, publish listings or write financial records.

## Claims, retries and audit

Migration `20261017090000_mercado_livre_notification_worker.sql` adds a five-minute lease and a claim UUID to queue events. Its service-role-only SECURITY DEFINER RPC uses a fixed `search_path`, bounded batch sizes, paired optional tenant filters and `FOR UPDATE SKIP LOCKED`. Settlement checks the company, event and claim UUID, so a stale worker cannot settle a row reclaimed by another invocation. Repeated settlement returns false and does not duplicate writes.

Each claim creates a sanitized attempt row. The event's existing receipt timestamp/status plus attempt rows record receipt, processing, success, retry and dead-letter outcomes without storing raw webhook/provider bodies, access tokens or seller/customer PII. Transient failures use 30s, 60s, 120s, 240s and 480s backoff; the sixth unsuccessful claim is dead-lettered. Permanent resource, authorization, identity, malformed-pointer and token failures go directly to dead-letter. A disconnected/missing connection is dead-lettered; a database lookup failure is retryable. Expired leases and legacy `processing` rows older than ten minutes can be reclaimed. The existing `process_notifications` management action now calls the same claim, processor and settlement contract for manual recovery.

Webhook dispatch can drain up to three bounded batches per trigger. `automation-scheduler` also dispatches a bounded recovery sweep on every scheduler tick. A periodic retry sweep therefore depends on the existing scheduler being invoked on a schedule. The local repository does not contain a recurring invocation configuration, and the previously observed remote project had no `pg_cron`/`pg_net`; this change does not install a new scheduler or claim that timed retries will run if the existing scheduler is not triggered. Until a recurring trigger is confirmed, new webhook deliveries and manual recovery can process due rows, but a retry whose backoff expires may wait for the next delivery/tick.

## Homologation rollout status

- Migration content `20261017090000_mercado_livre_notification_worker.sql` was applied to project `vwylnjmapixtzhryiutt`; Supabase recorded it under remote version `20261017012312` with the migration name. The migration adds an explicit `(company_id, id)` unique key required by the attempt ledger's tenant-scoped foreign key.
- `mercadolivre-api` v7, `mercadolivre-notification-worker` v1, and `mercadolivre-webhook` v8 are active. JWT verification remains enabled for API and worker, and disabled for the provider webhook, which validates the trusted source and canonical resource.
- The remote RLS, function grants, fixed `search_path`, and service-role-only RPC execution were checked after rollout. The queue and connected-account tables were empty at the preflight and remained empty afterward.
- Automated local coverage passed for worker concurrency, idempotency, tenant isolation, retries/dead-letter, manual recovery, and sanitized failures. An isolated PostgreSQL 17.11 fixture applied the migration against the previous schema and exercised claim, lease, settlement, and privilege checks.
- Unauthenticated worker invocation was rejected; an untrusted webhook source was rejected before queueing. No OAuth, provider request, catalog/order sync, or commercial write was executed.

## Remaining recovery-schedule dependency

Homologation has no active recurring trigger: `pg_cron` and `pg_net` are not installed, `cron.job` is absent, and no `automation-scheduler` Edge Function is deployed. The worker is dispatched immediately after a valid webhook and can drain bounded batches, but delayed retries do not have a confirmed periodic wake-up. Installing extensions and creating a secure scheduled caller would require storing an authorization key in Vault or another protected configuration; that configuration was not changed in this rollout. Do not describe delayed retries as fully automatic until that schedule is configured and observed running.

The presence of `MELI_TOKEN_ENCRYPTION_KEY` and `APP_ORIGIN` could not be inspected through the connected read-only Supabase tools. No secret was read, changed, created, or printed. OAuth remains pending until an owner verifies those secret names in the Homolog Dashboard and confirms that the Mercado Livre Developers redirect matches `https://vwylnjmapixtzhryiutt.supabase.co/functions/v1/mercadolivre-callback`.
