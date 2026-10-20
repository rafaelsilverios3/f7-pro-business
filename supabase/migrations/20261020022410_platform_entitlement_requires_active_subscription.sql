-- Fail closed for pending/unknown subscription states and inactive plans.
-- Companies without a subscription row retain the existing Free fallback.
-- No subscription, plan, payment, or entitlement rows are changed by this migration.

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
begin
  select coalesce(s.plan, 'free'), s.status, s.current_period_end, true
    into plan_name, subscription_status, period_end, subscription_found
  from public.company_subscriptions s
  where s.company_id = target_company;
  plan_name := coalesce(plan_name, 'free');

  -- A missing row uses the Free fallback; an existing non-active state never
  -- receives paid-plan access from an override or catalog fallback.
  if subscription_found and subscription_status is distinct from 'active' then
    return false;
  end if;
  if subscription_status = 'active' and period_end is not null and period_end <= now() then
    return false;
  end if;

  select p.active into plan_is_active
  from public.plans p
  where p.code = plan_name;
  if plan_is_active is distinct from true then
    return false;
  end if;

  select o.enabled into override_enabled
  from public.company_feature_overrides o
  where o.company_id = target_company
    and o.feature = lower(trim(feature));
  if override_enabled is not null then return override_enabled; end if;

  select pf.enabled into configured
  from public.plan_features pf
  join public.plans p on p.id = pf.plan_id and p.active
  where p.code = plan_name
    and pf.feature = lower(trim(feature));
  if configured is not null then return configured; end if;

  return case lower(trim(feature))
    when 'intelligence' then plan_name in ('pro', 'business', 'premium')
    when 'automations' then plan_name in ('business', 'premium')
    when 'atendimento' then plan_name in ('business', 'premium')
    when 'advanced_reports' then plan_name in ('business', 'premium')
    when 'whatsapp' then plan_name in ('business', 'premium')
    when 'ai' then plan_name = 'premium'
    when 'ai_sales' then plan_name in ('pro', 'business', 'premium')
    when 'opportunity_radar' then plan_name in ('business', 'premium')
    when 'supplier_intelligence' then plan_name = 'premium'
    when 'external_product_intelligence' then plan_name in ('business', 'premium')
    else false
  end;
end;
$$;

-- Conceptual rollback: restore the exact prior function body from migration
-- 20261018180049_billing_dual_payment_models.sql. This is a behavior rollback
-- only; there are no data or schema changes to reverse.
