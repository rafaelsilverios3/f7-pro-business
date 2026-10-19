-- Bounded leases for provider-side subscription reconciliation.
-- The Edge Function is fail-closed until BILLING_RECONCILIATION_ENABLED=true.
begin;

alter table public.billing_subscriptions
  add column if not exists reconciliation_next_at timestamptz not null default now(),
  add column if not exists reconciliation_lease_token uuid,
  add column if not exists reconciliation_lease_expires_at timestamptz,
  add column if not exists reconciliation_attempts integer not null default 0
    check (reconciliation_attempts >= 0);

create index if not exists idx_billing_subscriptions_reconciliation_due
  on public.billing_subscriptions (reconciliation_next_at, updated_at)
  where provider_subscription_id is not null
    and status in ('pending','authorized','paused','past_due','cancelled');

create or replace function public.claim_billing_subscription_reconciliation_v1(
  p_limit integer default 25,
  p_lease_seconds integer default 120
) returns table (
  id uuid,
  company_id uuid,
  checkout_id uuid,
  plan_id uuid,
  provider_subscription_id text,
  amount_minor bigint,
  currency text,
  billing_period_snapshot text,
  lease_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 30 and 600 then
    raise exception using errcode='22023', message='INVALID_RECONCILIATION_BATCH';
  end if;

  return query
  with due as (
    select s.id
    from public.billing_subscriptions s
    where s.provider = 'mercado_pago'
      and s.provider_subscription_id is not null
      and s.status in ('pending','authorized','paused','past_due','cancelled')
      and s.reconciliation_next_at <= now()
      and (s.reconciliation_lease_expires_at is null or s.reconciliation_lease_expires_at <= now())
    order by s.reconciliation_next_at, s.updated_at, s.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.billing_subscriptions s
    set reconciliation_lease_token = gen_random_uuid(),
        reconciliation_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from due
    where s.id = due.id
    returning s.id, s.company_id, s.checkout_id, s.plan_id,
      s.provider_subscription_id, s.amount_minor, s.currency,
      s.billing_period_snapshot, s.reconciliation_lease_token
  )
  select claimed.id, claimed.company_id, claimed.checkout_id, claimed.plan_id,
    claimed.provider_subscription_id, claimed.amount_minor, claimed.currency,
    claimed.billing_period_snapshot, claimed.reconciliation_lease_token
  from claimed;
end;
$$;

create or replace function public.finish_billing_subscription_reconciliation_v1(
  p_subscription_id uuid,
  p_lease_token uuid,
  p_success boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare updated_id uuid;
begin
  if p_subscription_id is null or p_lease_token is null then
    raise exception using errcode='22023', message='INVALID_RECONCILIATION_LEASE';
  end if;
  update public.billing_subscriptions
  set reconciliation_lease_token = null,
      reconciliation_lease_expires_at = null,
      reconciliation_attempts = case when p_success then 0 else least(reconciliation_attempts + 1, 10) end,
      reconciliation_next_at = now() + case
        when p_success then interval '15 minutes'
        else make_interval(mins => least(5 * (2 ^ least(reconciliation_attempts, 7))::integer, 600))
      end
  where id = p_subscription_id and reconciliation_lease_token = p_lease_token
  returning id into updated_id;
  if updated_id is null then return jsonb_build_object('code','LEASE_NOT_OWNED'); end if;
  return jsonb_build_object('code','OK');
end;
$$;

revoke all on function public.claim_billing_subscription_reconciliation_v1(integer,integer) from public, anon, authenticated;
revoke all on function public.finish_billing_subscription_reconciliation_v1(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_billing_subscription_reconciliation_v1(integer,integer) to service_role;
grant execute on function public.finish_billing_subscription_reconciliation_v1(uuid,uuid,boolean) to service_role;

-- Conceptual rollback: disable the scheduled caller first, wait for all active leases to expire,
-- then drop the two service-only RPCs, the partial index and the four reconciliation
-- columns. Preserve every subscription, payment, webhook and audit row; reconciliation
-- writes are represented in billing_webhook_events and billing_payments.
commit;
