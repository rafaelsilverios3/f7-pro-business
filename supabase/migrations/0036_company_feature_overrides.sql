-- Company-scoped feature overrides. Review and apply manually.
-- This does not enable any feature by itself.
create table if not exists public.company_feature_overrides (
  company_id uuid not null references public.companies(id) on delete cascade,
  feature text not null,
  enabled boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, feature)
);

alter table public.company_feature_overrides enable row level security;
drop policy if exists company_feature_overrides_select on public.company_feature_overrides;
create policy company_feature_overrides_select on public.company_feature_overrides
  for select to authenticated
  using (public.current_company_role(company_id) in ('admin', 'gestor'));

revoke all on public.company_feature_overrides from anon;
revoke insert, update, delete on public.company_feature_overrides from authenticated;
grant select on public.company_feature_overrides to authenticated;
grant select, insert, update, delete on public.company_feature_overrides to service_role;

create or replace function public.company_has_feature(target_company uuid, target_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  plan_name text;
  override_enabled boolean;
begin
  select enabled into override_enabled
    from public.company_feature_overrides
   where company_id = target_company and feature = lower(trim(target_feature));
  if override_enabled is not null then return override_enabled; end if;

  select coalesce(plan, 'free') into plan_name
    from public.company_subscriptions
   where company_id = target_company;
  return case lower(trim(target_feature))
    when 'intelligence' then true
    when 'automations' then plan_name in ('pro', 'business', 'premium')
    when 'atendimento' then plan_name in ('business', 'premium')
    when 'advanced_reports' then plan_name in ('business', 'premium')
    when 'whatsapp' then plan_name in ('business', 'premium')
    when 'ai' then plan_name = 'premium'
    else false
  end;
end;
$$;

revoke all on function public.company_has_feature(uuid, text) from public, anon;
grant execute on function public.company_has_feature(uuid, text) to authenticated, service_role;
