begin;

select plan(5);

select is(
  (select pf.enabled from public.plan_features pf join public.plans p on p.id = pf.plan_id where p.code = 'free' and pf.feature = 'marketplace_integrations'),
  false,
  'Free does not include marketplace integrations'
);
select is(
  (select pf.enabled from public.plan_features pf join public.plans p on p.id = pf.plan_id where p.code = 'pro' and pf.feature = 'marketplace_integrations'),
  true,
  'Pro includes marketplace integrations'
);
select is(
  (select pf.enabled from public.plan_features pf join public.plans p on p.id = pf.plan_id where p.code = 'business' and pf.feature = 'marketplace_integrations'),
  true,
  'Business includes marketplace integrations'
);
select is(
  (select pf.enabled from public.plan_features pf join public.plans p on p.id = pf.plan_id where p.code = 'premium' and pf.feature = 'marketplace_integrations'),
  true,
  'Premium includes marketplace integrations'
);
select is(
  (select count(*) from public.plan_features where feature = 'marketplace_integrations'),
  4::bigint,
  'Catalog has one explicit marketplace entitlement for each current plan'
);

select * from finish();
rollback;
