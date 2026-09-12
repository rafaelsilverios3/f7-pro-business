-- Enable the existing company feature gate for the controlled AI Sales Assistant.
-- Explicit company_feature_overrides remain authoritative; plan fallback is business/premium.
create or replace function public.company_has_feature(target_company uuid, feature text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  plan_name text;
  override_enabled boolean;
begin
  select o.enabled into override_enabled
    from public.company_feature_overrides o
   where o.company_id = target_company and o.feature = lower(trim(feature));
  if override_enabled is not null then return override_enabled; end if;
  select coalesce(s.plan, 'free') into plan_name from public.company_subscriptions s where s.company_id = target_company;
  return case lower(trim(feature))
    when 'intelligence' then true
    when 'automations' then plan_name in ('pro', 'business', 'premium')
    when 'atendimento' then plan_name in ('business', 'premium')
    when 'advanced_reports' then plan_name in ('business', 'premium')
    when 'whatsapp' then plan_name in ('business', 'premium')
    when 'ai' then plan_name = 'premium'
    when 'ai_sales' then plan_name in ('business', 'premium')
    else false
  end;
end;
$$;

revoke all on function public.company_has_feature(uuid, text) from public, anon;
grant execute on function public.company_has_feature(uuid, text) to authenticated, service_role;
