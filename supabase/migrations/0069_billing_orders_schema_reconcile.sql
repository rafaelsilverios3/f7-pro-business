-- Reconcile Orders columns in environments where 0068 was recorded before schema publication.
alter table public.billing_checkout_sessions
  add column if not exists provider_order_id text;

alter table public.billing_webhook_events
  add column if not exists error_message text;

create index if not exists idx_billing_checkout_provider_order
  on public.billing_checkout_sessions(provider, provider_order_id);
