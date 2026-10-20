begin;

-- A lifetime grant has no end date. Do not fall back to the expired billing
-- period when exposing the effective access through the tenant subscription RPC.
-- Conceptual rollback: restore the get_current_subscription body from
-- 20261020151303_admin_plan_grants.sql after explicitly revoking any affected
-- lifetime grant; the corrected NULL validity is required for permanent access.
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
    case when g.id is not null then g.starts_at else s.current_period_start end,
    case when g.id is not null then g.ends_at else s.current_period_end end
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
