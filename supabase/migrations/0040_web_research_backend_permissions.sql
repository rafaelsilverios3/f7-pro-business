-- Server-side web research cache/audit permissions. Apply manually.
grant select, insert, update on table public.product_research_runs to service_role;
grant select, insert on table public.product_research_sources to service_role;
revoke insert, update, delete on table public.product_research_runs from anon, authenticated;
revoke insert, update, delete on table public.product_research_sources from anon, authenticated;

-- Keep external research behind the existing company feature override model.
-- Premium is the default eligible plan; a beta company must be enabled explicitly
-- through company_feature_overrides (feature = external_product_intelligence).
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
    when 'external_product_intelligence' then plan_name = 'premium'
    else false
  end;
end;
$$;
revoke all on function public.company_has_feature(uuid, text) from public, anon;
grant execute on function public.company_has_feature(uuid, text) to authenticated, service_role;
