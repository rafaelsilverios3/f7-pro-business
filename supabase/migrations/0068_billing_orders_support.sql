-- Orders API support for Checkout Transparente. Existing payment references remain intact.
alter table public.billing_checkout_sessions
  add column if not exists provider_order_id text;

alter table public.billing_webhook_events
  add column if not exists error_message text;

create index if not exists idx_billing_checkout_provider_order
  on public.billing_checkout_sessions(provider, provider_order_id);
-- Conceptual rollback: drop the added index and columns only after confirming
-- no application/backend uses them. provider_order_id and error_message values
-- written after application would be lost; export them first. No original
-- values can be reconstructed from the schema after those columns are dropped.
