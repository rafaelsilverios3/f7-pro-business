begin;

create table if not exists public.platform_owner_ai_usage_policies (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  temporary_limits_enabled boolean not null default true,
  daily_call_limit integer not null default 5 check (daily_call_limit between 1 and 1000),
  daily_web_query_limit integer not null default 0 check (daily_web_query_limit = 0),
  daily_budget_brl numeric(18,6) not null default 5 check (daily_budget_brl > 0 and daily_budget_brl <= 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (updated_by is null or updated_by=owner_user_id)
);
insert into public.platform_owner_ai_usage_policies(owner_user_id,temporary_limits_enabled,daily_call_limit,daily_web_query_limit,daily_budget_brl)
select user_id,true,5,0,5 from public.platform_admins where role='owner' and status='active' and expires_at is null
on conflict(owner_user_id) do nothing;

create table if not exists public.platform_owner_ai_usage_operations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  request_key text not null check (length(request_key) between 1 and 180),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  model_key text not null,
  rate_card_id uuid not null references public.ai_rate_cards(id) on delete restrict,
  rate_version text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  fx_to_brl numeric(18,8) not null check (fx_to_brl > 0),
  input_cost_per_1k numeric(20,10) not null check (input_cost_per_1k >= 0),
  output_cost_per_1k numeric(20,10) not null check (output_cost_per_1k >= 0),
  reserved_input_tokens integer not null check (reserved_input_tokens between 1 and 50000),
  reserved_output_tokens integer not null check (reserved_output_tokens between 1 and 16000),
  max_cost_brl numeric(18,6) not null check (max_cost_brl > 0),
  actual_input_tokens integer,
  actual_output_tokens integer,
  actual_cost_brl numeric(18,6),
  status text not null default 'reserved' check (status in ('reserved','settled','uncertain','released')),
  budget_day date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique(owner_user_id,request_key),
  check (status<>'settled' or (actual_input_tokens is not null and actual_output_tokens is not null and actual_cost_brl is not null))
);
create index if not exists platform_owner_ai_usage_daily_idx on public.platform_owner_ai_usage_operations(owner_user_id,budget_day,status);
alter table public.platform_owner_ai_usage_policies enable row level security;
alter table public.platform_owner_ai_usage_operations enable row level security;
revoke all on public.platform_owner_ai_usage_policies,public.platform_owner_ai_usage_operations from public,anon,authenticated,service_role;

create or replace function public.platform_owner_ai_usage_policy_v1()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=auth.uid(); policy_row public.platform_owner_ai_usage_policies; today_calls integer; today_cost numeric; today_actual numeric; today_reserved numeric; today_tokens bigint;
begin
  if actor is null or not exists(select 1 from public.platform_admins a where a.user_id=actor and a.role='owner' and a.status='active' and a.expires_at is null) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;
  insert into public.platform_owner_ai_usage_policies(owner_user_id) values(actor) on conflict(owner_user_id) do nothing;
  select * into policy_row from public.platform_owner_ai_usage_policies where owner_user_id=actor;
  select count(*) filter(where status in ('reserved','settled','uncertain'))::integer,
    coalesce(sum(case when status='settled' then actual_cost_brl else max_cost_brl end) filter(where status in ('reserved','settled','uncertain')),0),
    coalesce(sum(actual_cost_brl) filter(where status='settled'),0),
    coalesce(sum(max_cost_brl) filter(where status in ('reserved','uncertain')),0),
    coalesce(sum(coalesce(actual_input_tokens,0)+coalesce(actual_output_tokens,0)),0)::bigint
  into today_calls,today_cost,today_actual,today_reserved,today_tokens from public.platform_owner_ai_usage_operations where owner_user_id=actor and budget_day=(now() at time zone 'utc')::date;
  return jsonb_build_object('owner_exempt',true,'policy',jsonb_build_object('temporary_limits_enabled',policy_row.temporary_limits_enabled,'daily_call_limit',policy_row.daily_call_limit,'daily_web_query_limit',0,'daily_budget_brl',policy_row.daily_budget_brl,'updated_at',policy_row.updated_at),'usage',jsonb_build_object('calls',today_calls,'cost_brl',today_cost,'actual_cost_brl',today_actual,'reserved_brl',today_reserved,'tokens',today_tokens,'day_timezone','UTC'));
end $$;

create or replace function public.platform_owner_ai_usage_policy_update_v1(p_enabled boolean,p_daily_calls integer,p_daily_cost_brl numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=auth.uid(); before_row public.platform_owner_ai_usage_policies; after_row public.platform_owner_ai_usage_policies;
begin
  if actor is null or not exists(select 1 from public.platform_admins a where a.user_id=actor and a.role='owner' and a.status='active' and a.expires_at is null) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;
  if p_enabled is null or p_daily_calls not between 1 and 1000 or p_daily_cost_brl is null or p_daily_cost_brl not between 0.01 and 100000 or length(btrim(coalesce(p_reason,''))) not between 8 and 500 then raise exception using errcode='22023',message='OWNER_AI_LIMIT_INVALID'; end if;
  insert into public.platform_owner_ai_usage_policies(owner_user_id) values(actor) on conflict(owner_user_id) do nothing;
  select * into before_row from public.platform_owner_ai_usage_policies where owner_user_id=actor for update;
  update public.platform_owner_ai_usage_policies set temporary_limits_enabled=p_enabled,daily_call_limit=p_daily_calls,daily_web_query_limit=0,daily_budget_brl=p_daily_cost_brl,updated_at=now(),updated_by=actor where owner_user_id=actor returning * into after_row;
  insert into public.platform_admin_audit_logs(admin_user_id,action,entity,entity_id,before_data,after_data,reason)
    values(actor,'ai_credits.owner_temporary_limits.updated','platform_owner_ai_usage_policies',actor::text,to_jsonb(before_row),to_jsonb(after_row),btrim(p_reason));
  return to_jsonb(after_row);
end $$;

create or replace function public.reserve_platform_owner_ai_usage_v1(p_user uuid,p_company uuid,p_request_key text,p_request_hash text,p_provider text,p_model text,p_input integer,p_output integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare policy_row public.platform_owner_ai_usage_policies; rate public.ai_rate_cards; rate_count integer; fx numeric; max_brl numeric; used_calls integer; used_cost numeric; op public.platform_owner_ai_usage_operations; day_utc date:=(now() at time zone 'utc')::date;
begin
  if auth.role() is distinct from 'service_role' then return jsonb_build_object('ok',false,'code','SERVICE_ROLE_REQUIRED'); end if;
  if p_user is null or p_company is null or length(coalesce(p_request_key,'')) not between 1 and 180 or coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$' or length(coalesce(p_provider,'')) not between 1 and 200 or length(coalesce(p_model,'')) not between 1 and 160 or p_input not between 1 and 50000 or p_output not between 1 and 16000 then return jsonb_build_object('ok',false,'code','OWNER_AI_REQUEST_INVALID'); end if;
  if not exists(select 1 from public.company_users m where m.company_id=p_company and m.user_id=p_user and m.active)
    then return jsonb_build_object('ok',false,'code','AI_COMPANY_ACCESS_REQUIRED'); end if;
  if not exists(select 1 from public.platform_admins a where a.user_id=p_user and a.role='owner' and a.status='active' and a.expires_at is null) then return jsonb_build_object('ok',true,'is_owner',false); end if;
  insert into public.platform_owner_ai_usage_policies(owner_user_id) values(p_user) on conflict(owner_user_id) do nothing;
  select * into policy_row from public.platform_owner_ai_usage_policies where owner_user_id=p_user;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||day_utc::text||':owner-ai-usage',0));
  select * into op from public.platform_owner_ai_usage_operations where owner_user_id=p_user and request_key=p_request_key for update;
  if found then
    if op.company_id<>p_company or op.request_hash<>p_request_hash or op.model_key<>p_model or op.reserved_input_tokens<>p_input or op.reserved_output_tokens<>p_output then return jsonb_build_object('ok',true,'is_owner',true,'allowed',false,'code','OWNER_AI_IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('ok',true,'is_owner',true,'allowed',false,'code','OWNER_AI_REQUEST_ALREADY_USED','operation_id',op.id);
  end if;
  select count(*) into rate_count from public.ai_rate_cards r where r.rate_kind='model_tokens' and r.provider_key=p_provider and r.model_key=p_model and r.enabled and r.effective_from<=now() and (r.effective_until is null or r.effective_until>now());
  if rate_count<>1 then return jsonb_build_object('ok',true,'is_owner',true,'allowed',false,'code','AI_RATE_UNAVAILABLE'); end if;
  select * into rate from public.ai_rate_cards r where r.rate_kind='model_tokens' and r.provider_key=p_provider and r.model_key=p_model and r.enabled and r.effective_from<=now() and (r.effective_until is null or r.effective_until>now());
  if rate.currency='BRL' then fx:=1;
  elsif rate.currency='USD' then select coalesce(rp.fx_to_brl,c.usd_to_brl) into fx from public.ai_credit_pricing_config c left join public.ai_credit_rate_pricing rp on rp.rate_card_id=rate.id where c.singleton;
  else return jsonb_build_object('ok',true,'is_owner',true,'allowed',false,'code','OWNER_AI_CURRENCY_UNSUPPORTED'); end if;
  if fx is null or fx<=0 then return jsonb_build_object('ok',true,'is_owner',true,'allowed',false,'code','OWNER_AI_FX_UNAVAILABLE'); end if;
  max_brl:=ceil(((rate.input_cost_per_1k*p_input+rate.output_cost_per_1k*p_output)/1000)*fx*1000000)/1000000;
  if max_brl<=0 then max_brl:=0.000001; end if;
  select count(*) filter(where status in ('reserved','settled','uncertain'))::integer,
    coalesce(sum(case when status='settled' then actual_cost_brl else max_cost_brl end) filter(where status in ('reserved','settled','uncertain')),0)
  into used_calls,used_cost from public.platform_owner_ai_usage_operations where owner_user_id=p_user and budget_day=day_utc;
  if policy_row.temporary_limits_enabled and used_calls>=policy_row.daily_call_limit then return jsonb_build_object('ok',true,'is_owner',true,'allowed',false,'code','OWNER_AI_DAILY_CALL_LIMIT','calls_used',used_calls,'daily_call_limit',policy_row.daily_call_limit); end if;
  -- This is the Owner's independent global spend ceiling and remains active
  -- when temporary call/web pilot limits are later disabled.
  if used_cost+max_brl>policy_row.daily_budget_brl then return jsonb_build_object('ok',true,'is_owner',true,'allowed',false,'code','OWNER_AI_DAILY_BUDGET_EXCEEDED','cost_used_brl',used_cost,'max_cost_brl',max_brl,'daily_budget_brl',policy_row.daily_budget_brl); end if;
  insert into public.platform_owner_ai_usage_operations(owner_user_id,company_id,request_key,request_hash,model_key,rate_card_id,rate_version,currency,fx_to_brl,input_cost_per_1k,output_cost_per_1k,reserved_input_tokens,reserved_output_tokens,max_cost_brl,budget_day)
    values(p_user,p_company,p_request_key,p_request_hash,p_model,rate.id,rate.rate_version,rate.currency,fx,rate.input_cost_per_1k,rate.output_cost_per_1k,p_input,p_output,max_brl,day_utc) returning * into op;
  return jsonb_build_object('ok',true,'is_owner',true,'allowed',true,'operation_id',op.id,'max_cost_brl',max_brl,'daily_calls_used',used_calls+1,'daily_budget_brl',policy_row.daily_budget_brl,'temporary_limits_enabled',policy_row.temporary_limits_enabled,'currency',rate.currency,'rate_version',rate.rate_version);
end $$;

create or replace function public.settle_platform_owner_ai_usage_v1(p_operation uuid,p_user uuid,p_input integer,p_output integer,p_reliable boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare op public.platform_owner_ai_usage_operations; actual_brl numeric;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select * into op from public.platform_owner_ai_usage_operations where id=p_operation and owner_user_id=p_user for update;
  if not found then return jsonb_build_object('settled',false,'code','OWNER_AI_OPERATION_NOT_FOUND'); end if;
  if op.status='settled' then
    if op.actual_input_tokens=p_input and op.actual_output_tokens=p_output then return jsonb_build_object('settled',true,'duplicate',true,'actual_cost_brl',op.actual_cost_brl); end if;
    return jsonb_build_object('settled',false,'code','OWNER_AI_SETTLEMENT_CONFLICT');
  end if;
  if op.status<>'reserved' then return jsonb_build_object('settled',false,'code','OWNER_AI_OPERATION_NOT_RESERVED'); end if;
  if p_reliable is not true or p_input is null or p_output is null or p_input<0 or p_output<0 or p_input+p_output=0 or p_input>op.reserved_input_tokens or p_output>op.reserved_output_tokens then
    update public.platform_owner_ai_usage_operations set status='uncertain' where id=op.id;
    return jsonb_build_object('settled',false,'code','OWNER_AI_USAGE_UNCERTAIN');
  end if;
  actual_brl:=ceil(((op.input_cost_per_1k*p_input+op.output_cost_per_1k*p_output)/1000)*op.fx_to_brl*1000000)/1000000;
  if actual_brl>op.max_cost_brl then update public.platform_owner_ai_usage_operations set status='uncertain',actual_input_tokens=p_input,actual_output_tokens=p_output where id=op.id; return jsonb_build_object('settled',false,'code','OWNER_AI_CEILING_BREACHED'); end if;
  update public.platform_owner_ai_usage_operations set status='settled',actual_input_tokens=p_input,actual_output_tokens=p_output,actual_cost_brl=actual_brl,settled_at=now() where id=op.id;
  return jsonb_build_object('settled',true,'actual_cost_brl',actual_brl,'released_cost_brl',op.max_cost_brl-actual_brl);
end $$;

create or replace function public.release_platform_owner_ai_usage_v1(p_operation uuid,p_user uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  update public.platform_owner_ai_usage_operations set status='released',actual_cost_brl=0,settled_at=now() where id=p_operation and owner_user_id=p_user and status='reserved';
  return found;
end $$;

create or replace function public.check_platform_owner_web_policy_v1(p_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare policy_row public.platform_owner_ai_usage_policies;
begin
  if auth.role() is distinct from 'service_role' then return jsonb_build_object('ok',false,'code','SERVICE_ROLE_REQUIRED'); end if;
  if not exists(select 1 from public.platform_admins a where a.user_id=p_user and a.role='owner' and a.status='active' and a.expires_at is null) then return jsonb_build_object('ok',true,'is_owner',false,'allowed',true); end if;
  select * into policy_row from public.platform_owner_ai_usage_policies where owner_user_id=p_user;
  if not found then return jsonb_build_object('ok',true,'is_owner',true,'allowed',false,'code','OWNER_AI_POLICY_MISSING'); end if;
  return jsonb_build_object('ok',true,'is_owner',true,'allowed',not policy_row.temporary_limits_enabled or policy_row.daily_web_query_limit>0,'temporary_limits_enabled',policy_row.temporary_limits_enabled,'daily_web_query_limit',policy_row.daily_web_query_limit);
end $$;

revoke all on function public.platform_owner_ai_usage_policy_v1() from public,anon;
revoke all on function public.platform_owner_ai_usage_policy_update_v1(boolean,integer,numeric,text) from public,anon;
revoke all on function public.reserve_platform_owner_ai_usage_v1(uuid,uuid,text,text,text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.settle_platform_owner_ai_usage_v1(uuid,uuid,integer,integer,boolean) from public,anon,authenticated;
revoke all on function public.release_platform_owner_ai_usage_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.check_platform_owner_web_policy_v1(uuid) from public,anon,authenticated;
grant execute on function public.platform_owner_ai_usage_policy_v1() to authenticated;
grant execute on function public.platform_owner_ai_usage_policy_update_v1(boolean,integer,numeric,text) to authenticated;
grant execute on function public.reserve_platform_owner_ai_usage_v1(uuid,uuid,text,text,text,text,integer,integer) to service_role;
grant execute on function public.settle_platform_owner_ai_usage_v1(uuid,uuid,integer,integer,boolean) to service_role;
grant execute on function public.release_platform_owner_ai_usage_v1(uuid,uuid) to service_role;
grant execute on function public.check_platform_owner_web_policy_v1(uuid) to service_role;

commit;
