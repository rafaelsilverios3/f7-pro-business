-- F7 AI Credits: commercial balance is separate from provider spend budgets.
-- This migration is local until a reviewed, isolated validation and release.
begin;

create table if not exists public.ai_credit_plan_catalog (
  plan_code text primary key check (plan_code in ('free','pro','business','premium')),
  monthly_credits integer not null check (monthly_credits >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.ai_credit_plan_catalog(plan_code, monthly_credits) values
  ('free',0),('pro',200),('business',500),('premium',1500)
on conflict(plan_code) do nothing;

create table if not exists public.ai_credit_packages (
  package_code text primary key check (package_code in ('credits_500','credits_1000','credits_3000')),
  credits integer not null check (credits > 0),
  price_minor integer not null check (price_minor > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.ai_credit_packages(package_code,credits,price_minor) values
  ('credits_500',500,1990),('credits_1000',1000,3990),('credits_3000',3000,9990)
on conflict(package_code) do nothing;

create table if not exists public.ai_credit_pricing_config (
  singleton boolean primary key default true check (singleton),
  credit_value_brl numeric(18,8) not null default 0.01 check (credit_value_brl > 0),
  usd_to_brl numeric(18,8),
  markup_bps integer not null default 10000 check (markup_bps between 10000 and 1000000),
  confirmation_threshold_credits integer not null default 20 check (confirmation_threshold_credits >= 0),
  confirmation_balance_bps integer not null default 1000 check (confirmation_balance_bps between 0 and 10000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.ai_credit_pricing_config(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.ai_credit_rate_pricing (
  rate_card_id uuid primary key references public.ai_rate_cards(id) on delete restrict,
  markup_bps integer check (markup_bps is null or markup_bps between 10000 and 1000000),
  fx_to_brl numeric(18,8) check (fx_to_brl is null or fx_to_brl between 0.000001 and 1000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.ai_credit_wallets (
  company_id uuid primary key references public.companies(id) on delete cascade,
  monthly_allowance integer not null default 0 check (monthly_allowance >= 0),
  monthly_remaining integer not null default 0 check (monthly_remaining >= 0),
  extra_balance integer not null default 0 check (extra_balance >= 0),
  cycle_start timestamptz,
  cycle_end timestamptz,
  cycle_plan text check (cycle_plan is null or cycle_plan in ('free','pro','business','premium')),
  updated_at timestamptz not null default now(),
  check (monthly_remaining <= monthly_allowance)
);

create table if not exists public.company_ai_credit_overrides (
  company_id uuid primary key references public.companies(id) on delete cascade,
  monthly_allowance integer check (monthly_allowance is null or monthly_allowance between 0 and 1000000),
  expires_at timestamptz,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_credit_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  request_key text not null check (length(request_key) between 1 and 180),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  model_key text not null check (length(model_key) between 1 and 160),
  rate_card_id uuid not null references public.ai_rate_cards(id) on delete restrict,
  rate_version text not null,
  rate_currency text not null check (rate_currency ~ '^[A-Z]{3}$'),
  credit_cycle_start timestamptz not null,
  input_cost_per_1k numeric(20,10) not null,
  output_cost_per_1k numeric(20,10) not null,
  fx_to_brl numeric(18,8),
  markup_bps integer not null,
  credit_value_brl numeric(18,8) not null,
  max_input_tokens integer not null check (max_input_tokens > 0),
  max_output_tokens integer not null check (max_output_tokens > 0),
  max_credits integer not null check (max_credits > 0),
  reserved_monthly integer not null default 0 check (reserved_monthly >= 0),
  reserved_extra integer not null default 0 check (reserved_extra >= 0),
  actual_credits integer check (actual_credits is null or actual_credits >= 0),
  actual_input_tokens integer check (actual_input_tokens is null or actual_input_tokens >= 0),
  actual_output_tokens integer check (actual_output_tokens is null or actual_output_tokens >= 0),
  status text not null check (status in ('quoted','reserved','settled','cancelled','uncertain','expired')),
  quote_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  reserved_at timestamptz,
  settled_at timestamptz,
  unique(company_id, request_key),
  check ((status in ('reserved','settled','uncertain')) = (reserved_at is not null)),
  check ((status = 'settled') = (settled_at is not null))
);
create index if not exists ai_credit_operations_company_created_idx on public.ai_credit_operations(company_id, created_at desc);
create index if not exists ai_credit_operations_quote_expiry_idx on public.ai_credit_operations(quote_expires_at) where status='quoted';

create table if not exists public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  operation_id uuid references public.ai_credit_operations(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  entry_type text not null check (entry_type in ('monthly_grant','extra_purchase','bonus','reserve','settlement','release','refund','admin_adjustment')),
  monthly_delta integer not null default 0,
  extra_delta integer not null default 0,
  package_code text references public.ai_credit_packages(package_code) on delete restrict,
  reference_key text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, entry_type, reference_key)
);
create index if not exists ai_credit_ledger_company_created_idx on public.ai_credit_ledger(company_id, created_at desc);

create table if not exists public.ai_credit_purchase_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  package_code text not null references public.ai_credit_packages(package_code) on delete restrict,
  credits integer not null check (credits > 0),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency='BRL'),
  request_key text not null check (length(request_key) between 1 and 180),
  status text not null default 'created' check (status in ('created','pending','approved','rejected','refunded','cancelled')),
  provider_payment_id text,
  provider_order_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique(company_id, request_key),
  unique(provider_payment_id)
);
create index if not exists ai_credit_purchase_sessions_company_idx on public.ai_credit_purchase_sessions(company_id,created_at desc);

alter table public.ai_credit_plan_catalog enable row level security;
alter table public.ai_credit_packages enable row level security;
alter table public.ai_credit_pricing_config enable row level security;
alter table public.ai_credit_rate_pricing enable row level security;
alter table public.ai_credit_wallets enable row level security;
alter table public.company_ai_credit_overrides enable row level security;
alter table public.ai_credit_operations enable row level security;
alter table public.ai_credit_ledger enable row level security;
alter table public.ai_credit_purchase_sessions enable row level security;
revoke all on public.ai_credit_plan_catalog,public.ai_credit_packages,public.ai_credit_pricing_config,public.ai_credit_rate_pricing,public.ai_credit_wallets,public.company_ai_credit_overrides,public.ai_credit_operations,public.ai_credit_ledger,public.ai_credit_purchase_sessions from public,anon,authenticated,service_role;

-- Dedicated entitlement allows paid generation without unlocking unrelated Premium features.
insert into public.plan_features(plan_id,feature,enabled)
select p.id,'ai_credits_generation',p.code in ('pro','business','premium') from public.plans p
on conflict(plan_id,feature) do nothing;

create or replace function public.ensure_ai_credit_wallet_v1(target_company uuid)
returns public.ai_credit_wallets language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare sub public.company_subscriptions; cat public.ai_credit_plan_catalog; override_row public.company_ai_credit_overrides; w public.ai_credit_wallets; cycle_begin timestamptz; cycle_finish timestamptz; plan_name text; entitlement boolean; eligible boolean; old_allowance integer; wallet_rows integer;
begin
  if target_company is null then raise exception using errcode='22023',message='AI_CREDITS_COMPANY_REQUIRED'; end if;
  select * into sub from public.company_subscriptions s where s.company_id=target_company;
  if not found then plan_name:='free'; else plan_name:=coalesce(sub.plan,'free'); end if;
  entitlement := public.company_has_feature_internal(target_company,'ai_credits_generation');
  select * into cat from public.ai_credit_plan_catalog c where c.plan_code=plan_name and c.active;
  eligible:=found and entitlement and coalesce(sub.status,'') in ('active','past_due') and sub.current_period_start is not null and sub.current_period_start<=now() and sub.current_period_end is not null and sub.current_period_end>now();
  if not eligible then
    cat.monthly_credits:=0;
  end if;
  select * into override_row from public.company_ai_credit_overrides o where o.company_id=target_company and (o.expires_at is null or o.expires_at>now());
  if eligible and found and override_row.monthly_allowance is not null then cat.monthly_credits:=override_row.monthly_allowance; end if;
  cycle_begin:=sub.current_period_start;
  if cycle_begin is null then cycle_begin:=now(); end if;
  while cycle_begin + interval '1 month' <= now() loop cycle_begin:=cycle_begin + interval '1 month'; end loop;
  cycle_finish:=least(cycle_begin + interval '1 month',coalesce(sub.current_period_end,cycle_begin + interval '1 month'));
  insert into public.ai_credit_wallets(company_id,monthly_allowance,monthly_remaining,extra_balance,cycle_start,cycle_end,cycle_plan)
    values(target_company,coalesce(cat.monthly_credits,0),coalesce(cat.monthly_credits,0),0,cycle_begin,cycle_finish,plan_name)
    on conflict(company_id) do nothing;
  get diagnostics wallet_rows=row_count;
  if wallet_rows=1 and coalesce(cat.monthly_credits,0)>0 then
    insert into public.ai_credit_ledger(company_id,entry_type,monthly_delta,reference_key,details)
      values(target_company,'monthly_grant',coalesce(cat.monthly_credits,0),'cycle:'||cycle_begin::text,jsonb_build_object('plan',plan_name,'cycle_start',cycle_begin,'cycle_end',cycle_finish)) on conflict do nothing;
  end if;
  select * into w from public.ai_credit_wallets where company_id=target_company for update;
  if w.cycle_start is distinct from cycle_begin or w.cycle_end is distinct from cycle_finish then
    update public.ai_credit_wallets set monthly_allowance=coalesce(cat.monthly_credits,0),monthly_remaining=coalesce(cat.monthly_credits,0),cycle_start=cycle_begin,cycle_end=cycle_finish,cycle_plan=plan_name,updated_at=now()
      where company_id=target_company returning * into w;
    insert into public.ai_credit_ledger(company_id,entry_type,monthly_delta,reference_key,details)
      values(target_company,'monthly_grant',coalesce(cat.monthly_credits,0),'cycle:'||cycle_begin::text,jsonb_build_object('plan',plan_name,'cycle_start',cycle_begin,'cycle_end',cycle_finish)) on conflict do nothing;
  elsif w.monthly_allowance<>coalesce(cat.monthly_credits,0) or w.cycle_plan is distinct from plan_name then
    old_allowance:=w.monthly_allowance;
    update public.ai_credit_wallets set monthly_allowance=coalesce(cat.monthly_credits,0),
      monthly_remaining=case when cat.monthly_credits>w.monthly_allowance then least(cat.monthly_credits,w.monthly_remaining+(cat.monthly_credits-w.monthly_allowance)) else least(w.monthly_remaining,cat.monthly_credits) end,
      cycle_plan=plan_name,updated_at=now() where company_id=target_company returning * into w;
    if coalesce(cat.monthly_credits,0)>old_allowance then
      insert into public.ai_credit_ledger(company_id,entry_type,monthly_delta,reference_key,details)
        values(target_company,'monthly_grant',cat.monthly_credits-old_allowance,'plan-change:'||cycle_begin::text||':'||plan_name,jsonb_build_object('plan',plan_name,'cycle_start',cycle_begin)) on conflict do nothing;
    end if;
  end if;
  return w;
end $$;

create or replace function public.ai_credit_quote_reserve_v1(
  target_company uuid,target_user uuid,request_key text,request_hash text,provider_key text,model_key text,
  input_tokens integer,output_token_limit integer,quote_id uuid default null,confirm boolean default false
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare w public.ai_credit_wallets; op public.ai_credit_operations; rate public.ai_rate_cards; rate_pricing public.ai_credit_rate_pricing; cfg public.ai_credit_pricing_config; selected_fx numeric; selected_markup integer; cost_brl numeric; max_credits integer; balance integer; threshold integer; monthly_part integer; extra_part integer; existing_count integer;
begin
  if target_company is null or target_user is null or length(coalesce(request_key,'')) not between 1 and 180 or coalesce(request_hash,'') !~ '^[a-f0-9]{64}$' or length(coalesce(provider_key,'')) not between 1 and 200 or length(coalesce(model_key,'')) not between 1 and 160 or input_tokens not between 1 and 50000 or output_token_limit not between 1 and 16000 then
    return jsonb_build_object('allowed',false,'code','AI_CREDITS_REQUEST_INVALID');
  end if;
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from target_user then return jsonb_build_object('allowed',false,'code','AI_CREDITS_FORBIDDEN'); end if;
  if not exists(select 1 from public.company_users m where m.company_id=target_company and m.user_id=target_user and m.active and m.role in ('admin','gestor','comercial','vendedor','atendimento')) then return jsonb_build_object('allowed',false,'code','AI_CREDITS_FORBIDDEN'); end if;
  if not public.company_has_feature_internal(target_company,'ai_credits_generation') then return jsonb_build_object('allowed',false,'code','AI_CREDITS_ENTITLEMENT_REQUIRED'); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_company::text||':'||request_key,0));
  select * into op from public.ai_credit_operations where company_id=target_company and ai_credit_operations.request_key=ai_credit_quote_reserve_v1.request_key for update;
  if found then
    if op.user_id<>target_user or op.request_hash<>ai_credit_quote_reserve_v1.request_hash or op.model_key<>ai_credit_quote_reserve_v1.model_key or op.max_input_tokens<>input_tokens or op.max_output_tokens<>output_token_limit then return jsonb_build_object('allowed',false,'code','AI_CREDITS_IDEMPOTENCY_CONFLICT'); end if;
    if op.status='reserved' or op.status='settled' then return jsonb_build_object('allowed',false,'code','AI_CREDITS_ALREADY_EXECUTED','operation_id',op.id); end if;
    if op.status in ('cancelled','expired','uncertain') then return jsonb_build_object('allowed',false,'code','AI_CREDITS_OPERATION_CLOSED'); end if;
    if op.quote_expires_at<=now() then update public.ai_credit_operations set status='expired' where id=op.id; return jsonb_build_object('allowed',false,'code','AI_CREDITS_QUOTE_EXPIRED'); end if;
    if quote_id is not null and quote_id<>op.id then return jsonb_build_object('allowed',false,'code','AI_CREDITS_QUOTE_MISMATCH'); end if;
  else
    if quote_id is not null or confirm then return jsonb_build_object('allowed',false,'code','AI_CREDITS_QUOTE_MISMATCH'); end if;
    w:=public.ensure_ai_credit_wallet_v1(target_company);
    select * into cfg from public.ai_credit_pricing_config where singleton;
    select count(*) into existing_count from public.ai_rate_cards r where r.rate_kind='model_tokens' and r.provider_key=ai_credit_quote_reserve_v1.provider_key and r.model_key=ai_credit_quote_reserve_v1.model_key and r.enabled and r.effective_from<=now() and (r.effective_until is null or r.effective_until>now());
    select * into rate from public.ai_rate_cards r where r.rate_kind='model_tokens' and r.provider_key=ai_credit_quote_reserve_v1.provider_key and r.model_key=ai_credit_quote_reserve_v1.model_key and r.enabled and r.effective_from<=now() and (r.effective_until is null or r.effective_until>now()) order by r.effective_from desc limit 1;
    if not found or existing_count<>1 then return jsonb_build_object('allowed',false,'code','AI_CREDITS_RATE_UNAVAILABLE'); end if;
    select * into rate_pricing from public.ai_credit_rate_pricing rp where rp.rate_card_id=rate.id;
    selected_markup:=coalesce(rate_pricing.markup_bps,cfg.markup_bps,10000);
    selected_fx:=case when rate.currency='BRL' then 1 when rate_pricing.fx_to_brl is not null then rate_pricing.fx_to_brl when rate.currency='USD' then cfg.usd_to_brl else null end;
    if selected_fx is null then return jsonb_build_object('allowed',false,'code','AI_CREDITS_FX_UNCONFIGURED'); end if;
    if rate.currency in ('BRL','USD','EUR') then cost_brl:=((rate.input_cost_per_1k*input_tokens+rate.output_cost_per_1k*output_token_limit)/1000)*selected_fx*selected_markup/10000;
    else return jsonb_build_object('allowed',false,'code','AI_CREDITS_FX_UNCONFIGURED'); end if;
    max_credits:=greatest(1,ceil(cost_brl/coalesce(cfg.credit_value_brl,0.01))::integer);
    balance:=w.monthly_remaining+w.extra_balance;
    insert into public.ai_credit_operations(company_id,user_id,request_key,request_hash,model_key,rate_card_id,rate_version,rate_currency,credit_cycle_start,input_cost_per_1k,output_cost_per_1k,fx_to_brl,markup_bps,credit_value_brl,max_input_tokens,max_output_tokens,max_credits,status,quote_expires_at)
      values(target_company,target_user,request_key,request_hash,model_key,rate.id,rate.rate_version,rate.currency,w.cycle_start,rate.input_cost_per_1k,rate.output_cost_per_1k,selected_fx,selected_markup,cfg.credit_value_brl,input_tokens,output_token_limit,max_credits,'quoted',now()+interval '10 minutes') returning * into op;
  end if;
  w:=public.ensure_ai_credit_wallet_v1(target_company); balance:=w.monthly_remaining+w.extra_balance;
  if op.max_credits>balance then return jsonb_build_object('allowed',false,'code','AI_CREDITS_INSUFFICIENT','balance',balance,'max_credits',op.max_credits); end if;
  select * into cfg from public.ai_credit_pricing_config where singleton;
  threshold:=least(cfg.confirmation_threshold_credits,floor(balance*cfg.confirmation_balance_bps/10000.0)::integer);
  if op.max_credits>threshold and not confirm then return jsonb_build_object('allowed',false,'code','AI_CREDITS_CONFIRMATION_REQUIRED','quote_id',op.id,'max_credits',op.max_credits,'balance',balance,'minimum_balance_after',balance-op.max_credits,'expires_at',op.quote_expires_at,'model',op.model_key); end if;
  if confirm and (quote_id is null or quote_id<>op.id) then return jsonb_build_object('allowed',false,'code','AI_CREDITS_CONFIRMATION_REQUIRED'); end if;
  monthly_part:=least(w.monthly_remaining,op.max_credits); extra_part:=op.max_credits-monthly_part;
  update public.ai_credit_wallets set monthly_remaining=monthly_remaining-monthly_part,extra_balance=extra_balance-extra_part,updated_at=now() where company_id=target_company;
  update public.ai_credit_operations set status='reserved',reserved_monthly=monthly_part,reserved_extra=extra_part,reserved_at=now() where id=op.id returning * into op;
  insert into public.ai_credit_ledger(company_id,operation_id,user_id,entry_type,monthly_delta,extra_delta,reference_key,details)
    values(target_company,op.id,target_user,'reserve',-monthly_part,-extra_part,'operation:'||op.id,jsonb_build_object('max_credits',op.max_credits));
  return jsonb_build_object('allowed',true,'code','AI_CREDITS_RESERVED','operation_id',op.id,'max_credits',op.max_credits,'balance_before',balance,'minimum_balance_after',balance-op.max_credits);
end $$;

create or replace function public.settle_ai_credits_v1(target_company uuid,operation_id uuid,actual_input integer,actual_output integer,usage_reliable boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare op public.ai_credit_operations; w public.ai_credit_wallets; actual_brl numeric; credits_actual integer; monthly_charge integer; extra_charge integer; release_monthly integer; release_extra integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select * into op from public.ai_credit_operations where id=operation_id and company_id=target_company for update;
  if not found then return jsonb_build_object('settled',false,'code','AI_CREDITS_OPERATION_NOT_FOUND'); end if;
  if op.status='settled' then return jsonb_build_object('settled',true,'duplicate',true,'actual_credits',op.actual_credits); end if;
  if op.status<>'reserved' then return jsonb_build_object('settled',false,'code','AI_CREDITS_OPERATION_NOT_RESERVED'); end if;
  if not usage_reliable or actual_input is null or actual_output is null or actual_input<0 or actual_output<0 or actual_input>op.max_input_tokens or actual_output>op.max_output_tokens then
    update public.ai_credit_operations set status='uncertain' where id=op.id;
    return jsonb_build_object('settled',false,'code','AI_CREDITS_USAGE_UNCERTAIN');
  end if;
  w:=public.ensure_ai_credit_wallet_v1(target_company);
  actual_brl:=((op.input_cost_per_1k*actual_input+op.output_cost_per_1k*actual_output)/1000)*coalesce(op.fx_to_brl,0)*op.markup_bps/10000;
  credits_actual:=case when actual_brl=0 then 0 else ceil(actual_brl/op.credit_value_brl)::integer end;
  if credits_actual>op.max_credits then update public.ai_credit_operations set status='uncertain',actual_input_tokens=actual_input,actual_output_tokens=actual_output where id=op.id; return jsonb_build_object('settled',false,'code','AI_CREDITS_CEILING_BREACHED'); end if;
  monthly_charge:=least(credits_actual,op.reserved_monthly); extra_charge:=credits_actual-monthly_charge;
  release_monthly:=case when op.credit_cycle_start=w.cycle_start
    then least(op.reserved_monthly-monthly_charge,greatest(0,w.monthly_allowance-w.monthly_remaining)) else 0 end;
  release_extra:=op.reserved_extra-extra_charge;
  if release_extra<0 then update public.ai_credit_operations set status='uncertain' where id=op.id; return jsonb_build_object('settled',false,'code','AI_CREDITS_RESERVATION_INCONSISTENT'); end if;
  update public.ai_credit_wallets set monthly_remaining=monthly_remaining+release_monthly,extra_balance=extra_balance+release_extra,updated_at=now() where company_id=target_company;
  update public.ai_credit_operations set status='settled',actual_credits=credits_actual,actual_input_tokens=actual_input,actual_output_tokens=actual_output,settled_at=now() where id=op.id;
  insert into public.ai_credit_ledger(company_id,operation_id,user_id,entry_type,monthly_delta,extra_delta,reference_key,details)
    values(target_company,op.id,op.user_id,'settlement',-monthly_charge,-extra_charge,'settlement:'||op.id,jsonb_build_object('actual_credits',credits_actual,'input_tokens',actual_input,'output_tokens',actual_output));
  if release_monthly+release_extra>0 then insert into public.ai_credit_ledger(company_id,operation_id,user_id,entry_type,monthly_delta,extra_delta,reference_key,details) values(target_company,op.id,op.user_id,'release',release_monthly,release_extra,'release:'||op.id,jsonb_build_object('reserved',op.max_credits,'actual',credits_actual)); end if;
  return jsonb_build_object('settled',true,'actual_credits',credits_actual,'released_credits',release_monthly+release_extra);
end $$;

create or replace function public.ai_credits_snapshot_v1(target_company uuid,target_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare w public.ai_credit_wallets; used integer; events jsonb; plan_name text; packages jsonb;
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from target_user then raise exception using errcode='42501',message='AI_CREDITS_FORBIDDEN'; end if;
  if not exists(select 1 from public.company_users where company_id=target_company and user_id=target_user and active) then raise exception using errcode='42501',message='AI_CREDITS_FORBIDDEN'; end if;
  w:=public.ensure_ai_credit_wallet_v1(target_company);
  select coalesce(s.plan,'free') into plan_name from public.company_subscriptions s where s.company_id=target_company;
  select coalesce(sum(actual_credits),0)::integer into used from public.ai_credit_operations where company_id=target_company and status='settled' and created_at>=w.cycle_start and created_at<w.cycle_end;
  select coalesce(jsonb_agg(jsonb_build_object('type',entry_type,'monthly_delta',monthly_delta,'extra_delta',extra_delta,'created_at',created_at) order by created_at desc),'[]'::jsonb) into events from (select entry_type,monthly_delta,extra_delta,created_at from public.ai_credit_ledger where company_id=target_company order by created_at desc limit 50) l;
  select coalesce(jsonb_agg(jsonb_build_object('package_code',package_code,'credits',credits,'price_minor',price_minor,'currency',currency) order by credits),'[]'::jsonb) into packages from public.ai_credit_packages where active;
  return jsonb_build_object('plan',coalesce(plan_name,'free'),'monthly_allowance',w.monthly_allowance,'monthly_remaining',w.monthly_remaining,'extra_balance',w.extra_balance,'available',w.monthly_remaining+w.extra_balance,'used_this_cycle',used,'cycle_start',w.cycle_start,'cycle_end',w.cycle_end,'history',events,'packages',packages,'alerts',jsonb_build_object('eighty_percent',w.monthly_allowance>0 and used*100>=w.monthly_allowance*80,'one_hundred_percent',w.monthly_allowance>0 and used>=w.monthly_allowance));
end $$;

create or replace function public.cancel_ai_credit_quote_v1(target_company uuid,target_user uuid,quote_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from target_user then raise exception using errcode='42501',message='AI_CREDITS_FORBIDDEN'; end if;
  update public.ai_credit_operations set status='cancelled' where id=quote_id and company_id=target_company and user_id=target_user and status='quoted';
  return found;
end $$;

create or replace function public.create_ai_credit_purchase_v1(target_company uuid,target_user uuid,package_code text,request_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare pack public.ai_credit_packages; purchase public.ai_credit_purchase_sessions;
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from target_user then raise exception using errcode='42501',message='AI_CREDITS_FORBIDDEN'; end if;
  if not exists(select 1 from public.company_users where company_id=target_company and user_id=target_user and active and role in ('admin','gestor')) then raise exception using errcode='42501',message='AI_CREDITS_FORBIDDEN'; end if;
  if not public.company_has_feature_internal(target_company,'ai_credits_generation') then raise exception using errcode='42501',message='AI_CREDITS_ENTITLEMENT_REQUIRED'; end if;
  select * into pack from public.ai_credit_packages where ai_credit_packages.package_code=create_ai_credit_purchase_v1.package_code and active;
  if not found then return jsonb_build_object('code','AI_CREDIT_PACKAGE_UNAVAILABLE'); end if;
  insert into public.ai_credit_purchase_sessions(company_id,user_id,package_code,credits,amount_minor,currency,request_key)
    values(target_company,target_user,pack.package_code,pack.credits,pack.price_minor,pack.currency,request_key)
    on conflict on constraint ai_credit_purchase_sessions_company_id_request_key_key do nothing returning * into purchase;
  if purchase.id is null then select * into purchase from public.ai_credit_purchase_sessions where company_id=target_company and ai_credit_purchase_sessions.request_key=create_ai_credit_purchase_v1.request_key; if purchase.package_code<>pack.package_code then return jsonb_build_object('code','AI_CREDIT_PURCHASE_IDEMPOTENCY_CONFLICT'); end if; end if;
  return jsonb_build_object('code','OK','id',purchase.id,'credits',purchase.credits,'amount_minor',purchase.amount_minor,'currency',purchase.currency,'status',purchase.status);
end $$;

create or replace function public.settle_ai_credit_purchase_v1(p_purchase_id uuid,p_payment_id text,p_status text,p_amount_minor integer,p_currency text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare purchase public.ai_credit_purchase_sessions; wallet public.ai_credit_wallets; inserted_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select * into purchase from public.ai_credit_purchase_sessions where id=p_purchase_id for update;
  if not found then return jsonb_build_object('code','AI_CREDIT_PURCHASE_NOT_FOUND'); end if;
  if p_status='refunded' then
    if p_payment_id is null or (purchase.provider_payment_id is not null and purchase.provider_payment_id<>p_payment_id) or p_amount_minor<>purchase.amount_minor or upper(coalesce(p_currency,''))<>purchase.currency then return jsonb_build_object('code','AI_CREDIT_PURCHASE_PAYMENT_MISMATCH'); end if;
    if purchase.status<>'approved' then update public.ai_credit_purchase_sessions set status='refunded' where id=purchase.id; return jsonb_build_object('code','OK','status','refunded','credited',false); end if;
    wallet:=public.ensure_ai_credit_wallet_v1(purchase.company_id);
    insert into public.ai_credit_ledger(company_id,user_id,entry_type,extra_delta,package_code,reference_key,details)
      values(purchase.company_id,purchase.user_id,'refund',-least(wallet.extra_balance,purchase.credits),purchase.package_code,'refund:'||purchase.id,jsonb_build_object('provider_payment_id',p_payment_id)) on conflict do nothing;
    get diagnostics inserted_count=row_count;
    if inserted_count=1 then update public.ai_credit_wallets set extra_balance=extra_balance-least(extra_balance,purchase.credits),updated_at=now() where company_id=purchase.company_id; end if;
    update public.ai_credit_purchase_sessions set status='refunded' where id=purchase.id;
    return jsonb_build_object('code','OK','status','refunded','credited',false,'duplicate',inserted_count=0);
  end if;
  if p_status<>'approved' then
    update public.ai_credit_purchase_sessions set status=case when p_status in ('rejected','cancelled','refunded') then p_status else 'pending' end where id=purchase.id and status not in ('approved','refunded');
    return jsonb_build_object('code','OK','status',p_status,'credited',false);
  end if;
  if p_payment_id is null or length(p_payment_id) not between 1 and 120 or (purchase.provider_payment_id is not null and purchase.provider_payment_id<>p_payment_id) or p_amount_minor<>purchase.amount_minor or upper(coalesce(p_currency,''))<>purchase.currency then
    return jsonb_build_object('code','AI_CREDIT_PURCHASE_PAYMENT_MISMATCH');
  end if;
  if purchase.status='approved' then return jsonb_build_object('code','OK','status','approved','credited',true,'duplicate',true); end if;
  if purchase.status='refunded' then return jsonb_build_object('code','AI_CREDIT_PURCHASE_ALREADY_REFUNDED'); end if;
  update public.ai_credit_purchase_sessions set status='approved',provider_payment_id=p_payment_id,paid_at=now() where id=purchase.id;
  wallet:=public.ensure_ai_credit_wallet_v1(purchase.company_id);
  insert into public.ai_credit_ledger(company_id,user_id,entry_type,extra_delta,package_code,reference_key,details)
    values(purchase.company_id,purchase.user_id,'extra_purchase',purchase.credits,purchase.package_code,'purchase:'||purchase.id,jsonb_build_object('amount_minor',purchase.amount_minor,'currency',purchase.currency,'provider_payment_id',p_payment_id)) on conflict do nothing;
  get diagnostics inserted_count=row_count;
  if inserted_count=1 then update public.ai_credit_wallets set extra_balance=extra_balance+purchase.credits,updated_at=now() where company_id=purchase.company_id; end if;
  return jsonb_build_object('code','OK','status','approved','credited',true,'duplicate',inserted_count=0);
end $$;

create or replace function public.persist_ai_credit_purchase_provider_v1(p_purchase_id uuid,p_payment_id text,p_order_id text,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare purchase public.ai_credit_purchase_sessions;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select * into purchase from public.ai_credit_purchase_sessions where id=p_purchase_id for update;
  if not found then return jsonb_build_object('code','AI_CREDIT_PURCHASE_NOT_FOUND'); end if;
  if purchase.status in ('approved','refunded') then return jsonb_build_object('code','AI_CREDIT_PURCHASE_CLOSED'); end if;
  if p_payment_id is null or length(p_payment_id) not between 1 and 120 or p_order_id is null or length(p_order_id) not between 1 and 120 then return jsonb_build_object('code','AI_CREDIT_PROVIDER_RESPONSE_INVALID'); end if;
  update public.ai_credit_purchase_sessions set provider_payment_id=p_payment_id,provider_order_id=p_order_id,status=case when p_status in ('pending','rejected','cancelled') then p_status else 'pending' end where id=p_purchase_id;
  return jsonb_build_object('code','OK','purchase_id',p_purchase_id,'status','pending');
end $$;

create or replace function public.platform_admin_ai_credit_catalog_v1()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare plans jsonb; packages jsonb; config jsonb; rates jsonb; revenue jsonb;
begin
  if not exists(select 1 from public.platform_admins a where a.user_id=auth.uid() and a.status='active' and a.role in ('owner','admin','support','readonly') and (a.expires_at is null or a.expires_at>now())) then raise exception using errcode='42501',message='PLATFORM_ADMIN_REQUIRED'; end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by case p.plan_code when 'free' then 1 when 'pro' then 2 when 'business' then 3 else 4 end),'[]') into plans from public.ai_credit_plan_catalog p;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.credits),'[]') into packages from public.ai_credit_packages p;
  select to_jsonb(c) into config from public.ai_credit_pricing_config c where singleton;
  select coalesce(jsonb_agg(jsonb_build_object('rate_card_id',r.id,'provider_key',r.provider_key,'model_key',r.model_key,'rate_kind',r.rate_kind,'currency',r.currency,'rate_version',r.rate_version,'effective_from',r.effective_from,'effective_until',r.effective_until,'enabled',r.enabled,'markup_bps',rp.markup_bps,'fx_to_brl',rp.fx_to_brl) order by r.effective_from desc),'[]') into rates from public.ai_rate_cards r left join public.ai_credit_rate_pricing rp on rp.rate_card_id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('package_code',package_code,'sales',sales,'gross_minor',gross_minor) order by package_code),'[]') into revenue from (select package_code,count(*) filter(where status='approved') sales,coalesce(sum(amount_minor) filter(where status='approved'),0)::bigint gross_minor from public.ai_credit_purchase_sessions group by package_code) s;
  return jsonb_build_object('plans',plans,'packages',packages,'pricing',config,'rates',rates,'revenue',revenue);
end $$;

create or replace function public.platform_admin_ai_credit_company_v1(p_company uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare w public.ai_credit_wallets; override_row public.company_ai_credit_overrides; used integer; history jsonb;
begin
  if not exists(select 1 from public.platform_admins a where a.user_id=auth.uid() and a.status='active' and a.role in ('owner','admin','support','readonly') and (a.expires_at is null or a.expires_at>now())) then raise exception using errcode='42501',message='PLATFORM_ADMIN_REQUIRED'; end if;
  w:=public.ensure_ai_credit_wallet_v1(p_company);
  select * into override_row from public.company_ai_credit_overrides o where o.company_id=p_company;
  select coalesce(sum(actual_credits),0)::integer into used from public.ai_credit_operations where company_id=p_company and status='settled' and created_at>=w.cycle_start and created_at<w.cycle_end;
  select coalesce(jsonb_agg(jsonb_build_object('entry_type',entry_type,'monthly_delta',monthly_delta,'extra_delta',extra_delta,'created_at',created_at) order by created_at desc),'[]') into history from (select entry_type,monthly_delta,extra_delta,created_at from public.ai_credit_ledger where company_id=p_company order by created_at desc limit 50) l;
  return jsonb_build_object('wallet',jsonb_build_object('monthly_allowance',w.monthly_allowance,'monthly_remaining',w.monthly_remaining,'extra_balance',w.extra_balance,'used_this_cycle',used,'cycle_start',w.cycle_start,'cycle_end',w.cycle_end,'cycle_plan',w.cycle_plan,'override_monthly_allowance',override_row.monthly_allowance,'override_expires_at',override_row.expires_at),'history',history);
end $$;

create or replace function public.platform_admin_ai_credit_update_plan_v1(p_plan text,p_credits integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare before_row public.ai_credit_plan_catalog; after_row public.ai_credit_plan_catalog; actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.platform_admins a where a.user_id=actor and a.status='active' and a.role='owner' and (a.expires_at is null or a.expires_at>now())) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;
  if p_plan not in ('free','pro','business','premium') or p_credits not between 0 and 1000000 or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception using errcode='22023',message='AI_CREDITS_CONFIG_INVALID'; end if;
  select * into before_row from public.ai_credit_plan_catalog where plan_code=p_plan for update;
  update public.ai_credit_plan_catalog set monthly_credits=p_credits,updated_at=now(),updated_by=actor where plan_code=p_plan returning * into after_row;
  insert into public.platform_admin_audit_logs(admin_user_id,action,entity,entity_id,before_data,after_data,reason) values(actor,'ai_credits.plan_allowance.updated','ai_credit_plan_catalog',p_plan,to_jsonb(before_row),to_jsonb(after_row),btrim(p_reason));
  return to_jsonb(after_row);
end $$;

create or replace function public.platform_admin_ai_credit_update_pricing_v1(p_usd_to_brl numeric,p_markup_bps integer,p_threshold integer,p_balance_bps integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare before_row public.ai_credit_pricing_config; after_row public.ai_credit_pricing_config; actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.platform_admins a where a.user_id=actor and a.status='active' and a.role='owner' and (a.expires_at is null or a.expires_at>now())) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;
  if (p_usd_to_brl is not null and p_usd_to_brl not between 0.000001 and 1000000) or p_markup_bps not between 10000 and 1000000 or p_threshold not between 0 and 1000000 or p_balance_bps not between 0 and 10000 or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception using errcode='22023',message='AI_CREDITS_CONFIG_INVALID'; end if;
  select * into before_row from public.ai_credit_pricing_config where singleton for update;
  update public.ai_credit_pricing_config set usd_to_brl=p_usd_to_brl,markup_bps=p_markup_bps,confirmation_threshold_credits=p_threshold,confirmation_balance_bps=p_balance_bps,updated_by=actor,updated_at=now() where singleton returning * into after_row;
  insert into public.platform_admin_audit_logs(admin_user_id,action,entity,entity_id,before_data,after_data,reason) values(actor,'ai_credits.pricing.updated','ai_credit_pricing_config','global',to_jsonb(before_row),to_jsonb(after_row),btrim(p_reason));
  return to_jsonb(after_row);
end $$;

create or replace function public.platform_admin_ai_credit_update_rate_pricing_v1(p_rate_card_id uuid,p_markup_bps integer,p_fx_to_brl numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=auth.uid(); before_row public.ai_credit_rate_pricing; after_row public.ai_credit_rate_pricing;
begin
  if not exists(select 1 from public.platform_admins a where a.user_id=actor and a.status='active' and a.role='owner' and (a.expires_at is null or a.expires_at>now())) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;
  if p_rate_card_id is null or not exists(select 1 from public.ai_rate_cards r where r.id=p_rate_card_id) or (p_markup_bps is not null and p_markup_bps not between 10000 and 1000000) or (p_fx_to_brl is not null and p_fx_to_brl not between 0.000001 and 1000000) or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception using errcode='22023',message='AI_CREDITS_CONFIG_INVALID'; end if;
  select * into before_row from public.ai_credit_rate_pricing where rate_card_id=p_rate_card_id for update;
  insert into public.ai_credit_rate_pricing(rate_card_id,markup_bps,fx_to_brl,updated_by) values(p_rate_card_id,p_markup_bps,p_fx_to_brl,actor)
    on conflict(rate_card_id) do update set markup_bps=excluded.markup_bps,fx_to_brl=excluded.fx_to_brl,updated_by=actor,updated_at=now() returning * into after_row;
  insert into public.platform_admin_audit_logs(admin_user_id,action,entity,entity_id,before_data,after_data,reason) values(actor,'ai_credits.rate_pricing.updated','ai_credit_rate_pricing',p_rate_card_id::text,to_jsonb(before_row),to_jsonb(after_row),btrim(p_reason));
  return to_jsonb(after_row);
end $$;

create or replace function public.platform_admin_ai_credit_update_package_v1(p_package text,p_credits integer,p_price_minor integer,p_active boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare before_row public.ai_credit_packages; after_row public.ai_credit_packages; actor uuid:=auth.uid();
begin
  if not exists(select 1 from public.platform_admins a where a.user_id=actor and a.status='active' and a.role='owner' and (a.expires_at is null or a.expires_at>now())) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;
  if p_package not in ('credits_500','credits_1000','credits_3000') or p_credits not between 1 and 1000000 or p_price_minor not between 1 and 100000000 or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception using errcode='22023',message='AI_CREDITS_CONFIG_INVALID'; end if;
  select * into before_row from public.ai_credit_packages where package_code=p_package for update;
  update public.ai_credit_packages set credits=p_credits,price_minor=p_price_minor,active=p_active,updated_at=now(),updated_by=actor where package_code=p_package returning * into after_row;
  insert into public.platform_admin_audit_logs(admin_user_id,action,entity,entity_id,before_data,after_data,reason) values(actor,'ai_credits.package.updated','ai_credit_packages',p_package,to_jsonb(before_row),to_jsonb(after_row),btrim(p_reason));
  return to_jsonb(after_row);
end $$;

create or replace function public.platform_admin_ai_credit_adjust_company_v1(p_company uuid,p_monthly integer,p_bonus integer,p_reference text,p_expires_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=auth.uid(); before_wallet public.ai_credit_wallets; after_wallet public.ai_credit_wallets; bonus_inserted integer;
begin
  if not exists(select 1 from public.platform_admins a where a.user_id=actor and a.status='active' and a.role='owner' and (a.expires_at is null or a.expires_at>now())) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;
  if not exists(select 1 from public.companies where id=p_company) or (p_monthly is not null and p_monthly not between 0 and 1000000) or p_bonus not between 0 and 100000 or (p_expires_at is not null and p_expires_at<=now()) or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception using errcode='22023',message='AI_CREDITS_CONFIG_INVALID'; end if;
  select * into before_wallet from public.ai_credit_wallets where company_id=p_company;
  if p_monthly is null and p_expires_at is null then delete from public.company_ai_credit_overrides where company_id=p_company;
  else insert into public.company_ai_credit_overrides(company_id,monthly_allowance,expires_at,reason,updated_by) values(p_company,p_monthly,p_expires_at,btrim(p_reason),actor) on conflict(company_id) do update set monthly_allowance=excluded.monthly_allowance,expires_at=excluded.expires_at,reason=excluded.reason,updated_by=actor,updated_at=now(); end if;
  after_wallet:=public.ensure_ai_credit_wallet_v1(p_company);
  if p_bonus>0 then
    if p_reference is null or length(btrim(p_reference)) not between 8 and 120 then raise exception using errcode='22023',message='AI_CREDITS_REFERENCE_REQUIRED'; end if;
    insert into public.ai_credit_ledger(company_id,user_id,entry_type,extra_delta,reference_key,details) values(p_company,actor,'bonus',p_bonus,'bonus:'||btrim(p_reference),jsonb_build_object('reason',btrim(p_reason))) on conflict do nothing;
    get diagnostics bonus_inserted=row_count;
    if bonus_inserted=1 then update public.ai_credit_wallets set extra_balance=extra_balance+p_bonus,updated_at=now() where company_id=p_company returning * into after_wallet; end if;
  end if;
  insert into public.platform_admin_audit_logs(admin_user_id,company_id,action,entity,entity_id,before_data,after_data,reason) values(actor,p_company,'ai_credits.company_adjusted','ai_credit_wallets',p_company::text,to_jsonb(before_wallet),to_jsonb(after_wallet),btrim(p_reason));
  return to_jsonb(after_wallet);
end $$;

revoke all on function public.settle_ai_credit_purchase_v1(uuid,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.persist_ai_credit_purchase_provider_v1(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.platform_admin_ai_credit_catalog_v1() from public,anon,authenticated;
revoke all on function public.platform_admin_ai_credit_company_v1(uuid) from public,anon,authenticated;
revoke all on function public.platform_admin_ai_credit_update_plan_v1(text,integer,text) from public,anon;
revoke all on function public.platform_admin_ai_credit_update_pricing_v1(numeric,integer,integer,integer,text) from public,anon;
revoke all on function public.platform_admin_ai_credit_update_rate_pricing_v1(uuid,integer,numeric,text) from public,anon;
revoke all on function public.platform_admin_ai_credit_update_package_v1(text,integer,integer,boolean,text) from public,anon;
revoke all on function public.platform_admin_ai_credit_adjust_company_v1(uuid,integer,integer,text,timestamptz,text) from public,anon;
grant execute on function public.settle_ai_credit_purchase_v1(uuid,text,text,integer,text) to service_role;
grant execute on function public.persist_ai_credit_purchase_provider_v1(uuid,text,text,text) to service_role;
grant execute on function public.platform_admin_ai_credit_catalog_v1() to authenticated;
grant execute on function public.platform_admin_ai_credit_company_v1(uuid) to authenticated;
grant execute on function public.platform_admin_ai_credit_update_plan_v1(text,integer,text) to authenticated;
grant execute on function public.platform_admin_ai_credit_update_pricing_v1(numeric,integer,integer,integer,text) to authenticated;
grant execute on function public.platform_admin_ai_credit_update_rate_pricing_v1(uuid,integer,numeric,text) to authenticated;
grant execute on function public.platform_admin_ai_credit_update_package_v1(text,integer,integer,boolean,text) to authenticated;
grant execute on function public.platform_admin_ai_credit_adjust_company_v1(uuid,integer,integer,text,timestamptz,text) to authenticated;

revoke all on function public.ensure_ai_credit_wallet_v1(uuid) from public,anon,authenticated;
revoke all on function public.ai_credit_quote_reserve_v1(uuid,uuid,text,text,text,text,integer,integer,uuid,boolean) from public,anon,authenticated;
revoke all on function public.settle_ai_credits_v1(uuid,uuid,integer,integer,boolean) from public,anon,authenticated;
revoke all on function public.ai_credits_snapshot_v1(uuid,uuid) from public,anon;
revoke all on function public.cancel_ai_credit_quote_v1(uuid,uuid,uuid) from public,anon;
revoke all on function public.create_ai_credit_purchase_v1(uuid,uuid,text,text) from public,anon;
grant execute on function public.ensure_ai_credit_wallet_v1(uuid) to service_role;
grant execute on function public.ai_credit_quote_reserve_v1(uuid,uuid,text,text,text,text,integer,integer,uuid,boolean) to service_role;
grant execute on function public.settle_ai_credits_v1(uuid,uuid,integer,integer,boolean) to service_role;
grant execute on function public.ai_credits_snapshot_v1(uuid,uuid) to authenticated,service_role;
grant execute on function public.cancel_ai_credit_quote_v1(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.create_ai_credit_purchase_v1(uuid,uuid,text,text) to authenticated,service_role;

commit;
