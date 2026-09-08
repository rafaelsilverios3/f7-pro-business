-- Company-scoped assistant configuration. This migration is intentionally not applied remotely.
create table if not exists public.company_assistant_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  commercial_name text,
  segment text,
  business_description text,
  tone text not null default 'professional' check (tone in ('professional','friendly','objective','consultative','casual','custom')),
  language text not null default 'pt-BR',
  business_hours jsonb not null default '{}',
  welcome_message text,
  out_of_hours_message text,
  closing_message text,
  payment_methods text,
  delivery_policy text,
  return_policy text,
  important_information text,
  specific_rules text,
  mode text not null default 'manual' check (mode in ('manual','assisted','automatic')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_quick_replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reply_key text not null,
  title text not null,
  body text not null,
  category text not null default 'general',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, reply_key)
);

create table if not exists public.company_handoff_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  trigger_key text not null,
  label text not null,
  enabled boolean not null default true,
  priority integer not null default 100 check (priority >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, trigger_key)
);

-- Keep timestamps consistent for updates made through the API or SQL.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists company_assistant_settings_set_updated_at on public.company_assistant_settings;
create trigger company_assistant_settings_set_updated_at
before update on public.company_assistant_settings
for each row execute function public.set_updated_at();

drop trigger if exists company_quick_replies_set_updated_at on public.company_quick_replies;
create trigger company_quick_replies_set_updated_at
before update on public.company_quick_replies
for each row execute function public.set_updated_at();

drop trigger if exists company_handoff_rules_set_updated_at on public.company_handoff_rules;
create trigger company_handoff_rules_set_updated_at
before update on public.company_handoff_rules
for each row execute function public.set_updated_at();

alter table public.company_assistant_settings enable row level security;
alter table public.company_quick_replies enable row level security;
alter table public.company_handoff_rules enable row level security;

grant select, insert, update, delete on public.company_assistant_settings to authenticated;
grant select, insert, update, delete on public.company_quick_replies to authenticated;
grant select, insert, update, delete on public.company_handoff_rules to authenticated;

drop policy if exists assistant_settings_select on public.company_assistant_settings;
drop policy if exists assistant_settings_manage on public.company_assistant_settings;
create policy assistant_settings_select on public.company_assistant_settings for select to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'));
create policy assistant_settings_manage on public.company_assistant_settings for all to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor'))
  with check (public.current_company_role(company_id) in ('admin','gestor'));

drop policy if exists quick_replies_select on public.company_quick_replies;
drop policy if exists quick_replies_manage on public.company_quick_replies;
create policy quick_replies_select on public.company_quick_replies for select to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'));
create policy quick_replies_manage on public.company_quick_replies for all to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor'))
  with check (public.current_company_role(company_id) in ('admin','gestor'));

drop policy if exists handoff_rules_select on public.company_handoff_rules;
drop policy if exists handoff_rules_manage on public.company_handoff_rules;
create policy handoff_rules_select on public.company_handoff_rules for select to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'));
create policy handoff_rules_manage on public.company_handoff_rules for all to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor'))
  with check (public.current_company_role(company_id) in ('admin','gestor'));
