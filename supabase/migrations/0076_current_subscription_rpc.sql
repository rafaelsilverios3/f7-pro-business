-- Expose only the current tenant's subscription to authenticated members.
-- The canonical subscription remains company_subscriptions; this RPC only
-- provides a narrow, tenant-safe read path for the UI header.
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
set search_path = public
as $$
  select
    s.company_id,
    s.plan,
    s.status,
    s.trial_ends_at,
    s.current_period_start,
    s.current_period_end
  from public.company_subscriptions as s
  where s.company_id = target_company
    and auth.uid() is not null
    and exists (
      select 1
      from public.company_users as cu
      where cu.company_id = s.company_id
        and cu.user_id = auth.uid()
        and cu.active = true
    )
  limit 1;
$$;

revoke all on function public.get_current_subscription(uuid) from public, anon;
grant execute on function public.get_current_subscription(uuid) to authenticated;
