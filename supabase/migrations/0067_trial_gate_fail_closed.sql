-- Active trials are intentionally not entitled to premium features.
-- Overrides remain valid only for paid/active subscriptions.
create or replace function public.company_has_feature(target_company uuid, feature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare plan_name text; subscription_status text; trial_end timestamptz; override_enabled boolean; configured boolean;
begin
  select coalesce(s.plan, 'free'), s.status, s.trial_ends_at into plan_name, subscription_status, trial_end
    from public.company_subscriptions s where s.company_id = target_company;
  if subscription_status = 'trial' then return false; end if;
  if subscription_status in ('expired','cancelled','suspended','past_due') then return false; end if;
  select o.enabled into override_enabled from public.company_feature_overrides o where o.company_id = target_company and o.feature = lower(trim($2));
  if override_enabled is not null then return override_enabled; end if;
  select pf.enabled into configured from public.plan_features pf join public.plans p on p.id = pf.plan_id
    where p.code = plan_name and p.active and pf.feature = lower(trim($2));
  if configured is not null then return configured; end if;
  return case lower(trim($2))
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
end; $$;
revoke all on function public.company_has_feature(uuid, text) from public, anon;
grant execute on function public.company_has_feature(uuid, text) to authenticated, service_role;
