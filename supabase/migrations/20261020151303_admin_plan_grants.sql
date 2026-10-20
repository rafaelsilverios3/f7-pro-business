-- Administrative plan grants are independent of provider billing history.
-- Temporary grants become ineffective from the resolver as soon as ends_at passes;
-- no scheduled job or mutation of a paid subscription is needed.
-- Conceptual rollback: disable grant mutation endpoints and restore the prior
-- resolver only after active grants are migrated or explicitly ended; retain this ledger.
begin;

create table public.company_plan_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_code text not null references public.plans(code),
  grant_type text not null check (grant_type in ('trial','courtesy','lifetime')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  granted_by uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 8 and 500),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint company_plan_grants_valid_term check (
    (grant_type = 'lifetime' and ends_at is null)
    or (grant_type <> 'lifetime' and ends_at is not null and ends_at > starts_at)
  ),
  constraint company_plan_grants_revocation_pair check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null and length(btrim(coalesce(revoke_reason,''))) >= 8)
  )
);

create index company_plan_grants_company_window_idx
  on public.company_plan_grants(company_id, starts_at desc, created_at desc)
  where revoked_at is null;

alter table public.company_plan_grants enable row level security;
revoke all on public.company_plan_grants from public, anon, authenticated;
grant all on public.company_plan_grants to service_role;

create or replace function public.platform_admin_create_plan_grant(
  p_company_id uuid,
  p_plan_code text,
  p_grant_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  company_name text;
  grant_row public.company_plan_grants;
  audit_id uuid;
begin
  select pa.role into actor_role from public.platform_admins pa
   where pa.user_id = actor_id and pa.status = 'active'
     and ((pa.role in ('owner','admin') and pa.expires_at is null)
       or (pa.role not in ('owner','admin') and pa.expires_at > statement_timestamp()));
  if actor_role not in ('owner','admin') then
    raise exception using errcode = '42501', message = 'PLATFORM_PLAN_GRANT_FORBIDDEN';
  end if;
  if p_company_id is null or p_plan_code is null or p_plan_code not in ('free','pro','business','premium')
     or p_grant_type is null or p_grant_type not in ('trial','courtesy','lifetime')
     or p_starts_at is null or p_starts_at < statement_timestamp() - interval '1 day'
     or length(btrim(coalesce(p_reason,''))) < 8 or length(p_reason) > 500
     or p_reason ~* '(bearer[[:space:]]|api[_-]?key[[:space:]]*[:=]|token[[:space:]]*[:=]|sk-[[:alnum:]_-]{12,}|eyJ[[:alnum:]_-]{20,}\.)'
     or (p_grant_type = 'lifetime' and (actor_role <> 'owner' or p_ends_at is not null))
     or (p_grant_type <> 'lifetime' and (p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '5 years')) then
    raise exception using errcode = '22023', message = 'PLAN_GRANT_INPUT_INVALID';
  end if;
  select c.name into company_name from public.companies c where c.id = p_company_id;
  if not found then raise exception using errcode = 'P0002', message = 'PLAN_GRANT_COMPANY_NOT_FOUND'; end if;
  if not exists(select 1 from public.plans p where p.code = p_plan_code and p.active) then
    raise exception using errcode = '22023', message = 'PLAN_GRANT_PLAN_UNAVAILABLE';
  end if;
  insert into public.company_plan_grants(company_id,plan_code,grant_type,starts_at,ends_at,granted_by,reason)
  values(p_company_id,p_plan_code,p_grant_type,p_starts_at,p_ends_at,actor_id,btrim(p_reason))
  returning * into grant_row;
  insert into public.platform_admin_audit_logs(admin_user_id,actor_kind,company_id,action,entity,entity_id,after_data,reason)
  values(actor_id,'platform_admin',p_company_id,'company.plan_grant.created','company_plan_grants',grant_row.id::text,to_jsonb(grant_row),btrim(p_reason))
  returning id into audit_id;
  return jsonb_build_object('grant',to_jsonb(grant_row),'audit_id',audit_id,'company_name',company_name);
end;
$$;

create or replace function public.platform_admin_revoke_plan_grant(
  p_grant_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  grant_row public.company_plan_grants;
  before_row public.company_plan_grants;
  audit_id uuid;
begin
  select pa.role into actor_role from public.platform_admins pa
   where pa.user_id = actor_id and pa.status = 'active'
     and ((pa.role in ('owner','admin') and pa.expires_at is null)
       or (pa.role not in ('owner','admin') and pa.expires_at > statement_timestamp()));
  if actor_role not in ('owner','admin') then
    raise exception using errcode = '42501', message = 'PLATFORM_PLAN_GRANT_FORBIDDEN';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 8 or length(p_reason) > 500
     or p_reason ~* '(bearer[[:space:]]|api[_-]?key[[:space:]]*[:=]|token[[:space:]]*[:=]|sk-[[:alnum:]_-]{12,}|eyJ[[:alnum:]_-]{20,}\.)' then
    raise exception using errcode = '22023', message = 'PLAN_GRANT_REASON_REQUIRED';
  end if;
  select * into before_row from public.company_plan_grants where id = p_grant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PLAN_GRANT_NOT_FOUND'; end if;
  if before_row.grant_type = 'lifetime' and actor_role <> 'owner' then
    raise exception using errcode = '42501', message = 'PLATFORM_PLAN_GRANT_OWNER_REQUIRED';
  end if;
  if before_row.revoked_at is not null then raise exception using errcode = '23514', message = 'PLAN_GRANT_ALREADY_REVOKED'; end if;
  update public.company_plan_grants set revoked_at = statement_timestamp(), revoked_by = actor_id, revoke_reason = btrim(p_reason)
   where id = p_grant_id returning * into grant_row;
  insert into public.platform_admin_audit_logs(admin_user_id,actor_kind,company_id,action,entity,entity_id,before_data,after_data,reason)
  values(actor_id,'platform_admin',grant_row.company_id,'company.plan_grant.revoked','company_plan_grants',grant_row.id::text,to_jsonb(before_row),to_jsonb(grant_row),btrim(p_reason))
  returning id into audit_id;
  return jsonb_build_object('grant',to_jsonb(grant_row),'audit_id',audit_id);
end;
$$;

revoke all on function public.platform_admin_create_plan_grant(uuid,text,text,timestamptz,timestamptz,text) from public, anon;
revoke all on function public.platform_admin_revoke_plan_grant(uuid,text) from public, anon;
grant execute on function public.platform_admin_create_plan_grant(uuid,text,text,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.platform_admin_revoke_plan_grant(uuid,text) to authenticated;

create or replace function public.company_has_feature_internal(target_company uuid, feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  plan_name text;
  subscription_status text;
  subscription_found boolean := false;
  period_end timestamptz;
  plan_is_active boolean;
  override_enabled boolean;
  configured boolean;
  manual_grant_found boolean := false;
begin
  select g.plan_code, true into plan_name, manual_grant_found
  from public.company_plan_grants g
  join public.plans p on p.code = g.plan_code and p.active
  where g.company_id = target_company
    and g.revoked_at is null
    and g.starts_at <= statement_timestamp()
    and (g.ends_at is null or g.ends_at > statement_timestamp())
  order by g.starts_at desc, g.created_at desc
  limit 1;

  if not manual_grant_found then
    select coalesce(s.plan, 'free'), s.status, s.current_period_end, true
      into plan_name, subscription_status, period_end, subscription_found
    from public.company_subscriptions s
    where s.company_id = target_company;
    plan_name := coalesce(plan_name, 'free');
    if subscription_found and subscription_status is distinct from 'active' then return false; end if;
    if subscription_status = 'active' and period_end is not null and period_end <= statement_timestamp() then return false; end if;
  end if;

  select p.active into plan_is_active from public.plans p where p.code = plan_name;
  if plan_is_active is distinct from true then return false; end if;
  select o.enabled into override_enabled from public.company_feature_overrides o
   where o.company_id = target_company and o.feature = lower(trim($2));
  if override_enabled is not null then return override_enabled; end if;
  select pf.enabled into configured from public.plan_features pf join public.plans p on p.id = pf.plan_id and p.active
   where p.code = plan_name and pf.feature = lower(trim($2));
  if configured is not null then return configured; end if;
  return case lower(trim(feature))
    when 'intelligence' then plan_name in ('pro','business','premium')
    when 'automations' then plan_name in ('business','premium')
    when 'atendimento' then plan_name in ('business','premium')
    when 'advanced_reports' then plan_name in ('business','premium')
    when 'whatsapp' then plan_name in ('business','premium')
    when 'ai' then plan_name = 'premium'
    when 'ai_sales' then plan_name in ('pro','business','premium')
    when 'opportunity_radar' then plan_name in ('business','premium')
    when 'supplier_intelligence' then plan_name = 'premium'
    when 'external_product_intelligence' then plan_name in ('business','premium')
    else false
  end;
end;
$$;
revoke all on function public.company_has_feature_internal(uuid,text) from public, anon, authenticated;
grant execute on function public.company_has_feature_internal(uuid,text) to service_role;

-- Keep the tenant header aligned with the same effective plan used by entitlements.
create or replace function public.get_current_subscription(target_company uuid)
returns table (
  company_id uuid,
  plan text,
  status text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select s.company_id,
    coalesce(g.plan_code, s.plan),
    case when g.id is not null then 'active' else s.status end,
    s.trial_ends_at,
    coalesce(g.starts_at, s.current_period_start),
    coalesce(g.ends_at, s.current_period_end)
  from public.company_subscriptions s
  left join lateral (
    select pg.id, pg.plan_code, pg.grant_type, pg.starts_at, pg.ends_at
    from public.company_plan_grants pg
    join public.plans p on p.code = pg.plan_code and p.active
    where pg.company_id = s.company_id and pg.revoked_at is null
      and pg.starts_at <= statement_timestamp()
      and (pg.ends_at is null or pg.ends_at > statement_timestamp())
    order by pg.starts_at desc, pg.created_at desc
    limit 1
  ) g on true
  where s.company_id = target_company
    and auth.uid() is not null
    and exists (
      select 1 from public.company_users cu
      where cu.company_id = s.company_id and cu.user_id = auth.uid() and cu.active = true
    )
  limit 1;
$$;
revoke all on function public.get_current_subscription(uuid) from public, anon;
grant execute on function public.get_current_subscription(uuid) to authenticated;

commit;
