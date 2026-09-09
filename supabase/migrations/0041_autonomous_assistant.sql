-- Optional autonomous reply foundation. Disabled by default; commercial transactions remain human-controlled.
alter table public.company_assistant_settings
  add column if not exists automatic_reply_enabled boolean not null default false,
  add column if not exists auto_reply_min_confidence text not null default 'high' check (auto_reply_min_confidence in ('confirmed','high','medium')),
  add column if not exists allow_web_research boolean not null default true,
  add column if not exists allow_product_lookup boolean not null default true,
  add column if not exists allow_price_lookup boolean not null default false,
  add column if not exists allow_stock_lookup boolean not null default false,
  add column if not exists human_handoff_on_low_confidence boolean not null default true;

create table if not exists public.assistant_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  provider_message_id text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed','handed_off')),
  decision jsonb,
  response_message_id uuid references public.messages(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, provider_message_id)
);

create index if not exists assistant_jobs_queue_idx on public.assistant_jobs(company_id, status, created_at);
alter table public.assistant_jobs enable row level security;
revoke all on public.assistant_jobs from anon, authenticated;
grant select, insert, update on public.assistant_jobs to service_role;

drop trigger if exists assistant_jobs_set_updated_at on public.assistant_jobs;
create trigger assistant_jobs_set_updated_at before update on public.assistant_jobs for each row execute function public.set_updated_at();
