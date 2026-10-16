-- Marketplace integrations are included in every paid F7 Business plan.
-- Free remains explicitly excluded. Subscription lifecycle, company overrides,
-- role checks and tenant isolation continue to be enforced by existing code.
insert into public.plan_features (plan_id, feature, enabled)
select
  p.id,
  'marketplace_integrations',
  p.code in ('pro', 'business', 'premium')
from public.plans p
where p.code in ('free', 'pro', 'business', 'premium')
on conflict (plan_id, feature)
do update set enabled = excluded.enabled, updated_at = now();
