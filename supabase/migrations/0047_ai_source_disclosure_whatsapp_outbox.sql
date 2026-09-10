-- Incremental hardening for assistant provenance policy and WhatsApp outbound
-- reconciliation. Apply manually after reviewing the production schema.
-- Conceptual rollback: remove the added disclosure column and outbox objects
-- only after no queued/provider_accepted records remain and an explicit backup exists.

alter table public.company_assistant_settings
  add column if not exists allow_external_source_disclosure boolean not null default false;

create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  client_request_id uuid not null,
  content text not null check (length(content) between 1 and 4000),
  sender_type text not null check (sender_type in ('user','assistant')),
  sender_user_id uuid,
  status text not null default 'pending' check (status in ('pending','sending','retryable','delivery_unknown','provider_accepted','sent','failed')),
  provider_message_id text,
  provider_status integer,
  message_id uuid references public.messages(id) on delete set null,
  attempts integer not null default 0 check (attempts >= 0),
  attempt_token text,
  lease_expires_at timestamptz,
  provider_call_started_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, client_request_id)
);

alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_status_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_status_check
  check (status in ('pending','sending','retryable','delivery_unknown','provider_accepted','sent','failed'));

create index if not exists whatsapp_outbox_status_idx
  on public.whatsapp_outbox(company_id, status, created_at);

drop trigger if exists whatsapp_outbox_set_updated_at on public.whatsapp_outbox;
create trigger whatsapp_outbox_set_updated_at
before update on public.whatsapp_outbox
for each row execute function public.set_updated_at();

alter table public.whatsapp_outbox enable row level security;
revoke all on public.whatsapp_outbox from anon, authenticated;
grant select, insert, update on public.whatsapp_outbox to service_role;

comment on column public.company_assistant_settings.allow_external_source_disclosure is
  'Explicit company policy controlling whether external research provenance may be shown to customers; internal logs retain full provenance.';
comment on table public.whatsapp_outbox is
  'Server-side idempotency and reconciliation records. provider_accepted and delivery_unknown rows are never sent to Meta again.';
