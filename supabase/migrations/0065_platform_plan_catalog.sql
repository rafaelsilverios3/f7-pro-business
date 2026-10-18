-- Commercial catalog configuration. Values are controlled here, never in the browser.
update public.plans set
  price_minor = case code
    when 'free' then 0
    when 'pro' then 6990
    when 'business' then 14990
    when 'premium' then 29990
  end,
  currency = 'BRL', billing_period = 'month',
  name = upper(code),
  description = case code
    when 'free' then 'Comece a organizar seu negócio. Plano gratuito para centralizar a gestão essencial da empresa.'
    when 'pro' then 'Gestão com inteligência para vender melhor. Para negócios que querem utilizar IA no dia a dia comercial.'
    when 'business' then 'O F7 trabalhando a favor do seu negócio. Inteligência, oportunidades e automações proativas.'
    when 'premium' then 'Inteligência completa para escalar. Recursos avançados, maior capacidade de IA e Supplier Intelligence.'
  end,
  highlighted = code = 'business',
  updated_at = now()
where code in ('free', 'pro', 'business', 'premium');

-- These are existing product capabilities, represented as explicit plan entitlements.
insert into public.plan_features (plan_id, feature, enabled)
select p.id, f.feature, (p.code = any(f.enabled_plans))
from public.plans p
cross join (values
  ('intelligence', array['free','pro','business','premium']::text[]),
  ('automations', array['business','premium']::text[]),
  ('atendimento', array['business','premium']::text[]),
  ('advanced_reports', array['business','premium']::text[]),
  ('whatsapp', array['business','premium']::text[]),
  ('ai', array['premium']::text[]),
  ('ai_sales', array['pro','business','premium']::text[]),
  ('opportunity_radar', array['business','premium']::text[]),
  ('supplier_intelligence', array['premium']::text[]),
  ('external_product_intelligence', array['business','premium']::text[])
) as f(feature, enabled_plans)
where p.code = any(f.enabled_plans)
on conflict (plan_id, feature) do update set enabled = excluded.enabled, updated_at = now();

-- Explicitly close capabilities for plans where the row already exists.
update public.plan_features pf set enabled = false, updated_at = now()
from public.plans p
where pf.plan_id = p.id
  and ((pf.feature = 'automations' and p.code = 'pro')
    or (pf.feature = 'ai_sales' and p.code = 'free'));

create or replace function public.company_has_feature(target_company uuid, feature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare plan_name text; override_enabled boolean; configured boolean;
begin
  select o.enabled into override_enabled from public.company_feature_overrides o where o.company_id = target_company and o.feature = lower(trim($2));
  if override_enabled is not null then return override_enabled; end if;
  select coalesce(s.plan, 'free') into plan_name from public.company_subscriptions s where s.company_id = target_company;
  select pf.enabled into configured from public.plan_features pf join public.plans p on p.id = pf.plan_id where p.code = plan_name and p.active and pf.feature = lower(trim($2));
  if configured is not null then return configured; end if;
  return case lower(trim($2))
    when 'intelligence' then true
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
-- Conceptual rollback: restore plan and plan_features values from a verified
-- pre-migration snapshot, including values overwritten by UPDATE/UPSERT, and
-- restore the preceding company_has_feature function/grants. No lossless SQL
-- inverse exists without that snapshot; later entitlement changes may also
-- depend on these values, so prefer an audited forward correction if uncertain.
