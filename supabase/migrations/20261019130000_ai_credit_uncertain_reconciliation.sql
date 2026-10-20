-- Audited, idempotent owner workflow for reservations whose provider outcome
-- could not be settled automatically. Unknown outcomes remain held.
-- Conceptual rollback: disable the platform-admin recovery actions first. Keep
-- reconciled operation, ledger, and platform audit rows as financial history.
-- Reverting the schema requires a backup and forward reconciliation; never
-- delete released/settled records or reverse wallet movements by dropping DDL.

alter table public.ai_credit_operations
  drop constraint if exists ai_credit_operations_status_check;
alter table public.ai_credit_operations
  add constraint ai_credit_operations_status_check
  check (status in ('quoted','reserved','settled','cancelled','uncertain','expired','released'));

alter table public.ai_credit_operations
  drop constraint if exists ai_credit_operations_reservation_timestamp_check;
alter table public.ai_credit_operations
  add constraint ai_credit_operations_reservation_timestamp_check
  check ((status in ('reserved','settled','uncertain','released')) = (reserved_at is not null));

alter table public.ai_credit_operations
  add column if not exists reconciliation_resolution text,
  add column if not exists reconciliation_evidence_ref text,
  add column if not exists reconciled_by uuid references auth.users(id) on delete restrict,
  add column if not exists reconciled_at timestamptz;

alter table public.ai_credit_operations
  drop constraint if exists ai_credit_operations_reconciliation_resolution_check;
alter table public.ai_credit_operations
  add constraint ai_credit_operations_reconciliation_resolution_check
  check (reconciliation_resolution is null or reconciliation_resolution in ('provider_not_sent','usage_confirmed'));

alter table public.ai_credit_operations
  drop constraint if exists ai_credit_operations_reconciliation_metadata_check;
alter table public.ai_credit_operations
  add constraint ai_credit_operations_reconciliation_metadata_check
  check ((reconciliation_resolution is null) = (reconciliation_evidence_ref is null)
    and (reconciliation_resolution is null) = (reconciled_by is null)
    and (reconciliation_resolution is null) = (reconciled_at is null));

create or replace function public.platform_admin_ai_credit_reconcile_uncertain_v1(
  p_company uuid,
  p_operation_id uuid,
  p_resolution text,
  p_actual_input integer default null,
  p_actual_output integer default null,
  p_evidence_ref text default null,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  actor uuid:=auth.uid(); op public.ai_credit_operations; w public.ai_credit_wallets;
  actual_brl numeric; credits_actual integer; monthly_charge integer; extra_charge integer;
  release_monthly integer; release_extra integer; before_wallet jsonb; after_wallet jsonb;
  safe_evidence text:=btrim(coalesce(p_evidence_ref,'')); safe_reason text:=btrim(coalesce(p_reason,''));
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception using errcode='42501',message='AUTHENTICATED_OWNER_REQUIRED';
  end if;
  if not exists (
    select 1 from public.platform_admins a
    where a.user_id=actor and a.role='owner' and a.status='active' and a.expires_at is null
  ) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;
  if p_company is null or p_operation_id is null or p_resolution is null or p_resolution not in ('provider_not_sent','usage_confirmed')
     or length(safe_reason) not between 8 and 500
     or length(safe_evidence) not between 8 and 200
     or safe_evidence !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{7,199}$' then
    raise exception using errcode='22023',message='AI_CREDIT_RECONCILIATION_INPUT_INVALID';
  end if;

  select * into op from public.ai_credit_operations
    where id=p_operation_id and company_id=p_company for update;
  if not found then return jsonb_build_object('ok',false,'code','AI_CREDIT_OPERATION_NOT_FOUND'); end if;
  if op.status in ('released','settled') then
    if op.reconciliation_resolution=p_resolution and op.reconciliation_evidence_ref=safe_evidence then
      return jsonb_build_object('ok',true,'duplicate',true,'status',op.status,'resolution',op.reconciliation_resolution);
    end if;
    return jsonb_build_object('ok',false,'code','AI_CREDIT_OPERATION_CLOSED');
  end if;
  if op.status not in ('reserved','uncertain') then
    return jsonb_build_object('ok',false,'code','AI_CREDIT_OPERATION_NOT_RECONCILABLE');
  end if;
  select * into w from public.ai_credit_wallets where company_id=p_company for update;
  if not found then return jsonb_build_object('ok',false,'code','AI_CREDIT_WALLET_NOT_FOUND'); end if;
  before_wallet:=to_jsonb(w);

  if p_resolution='provider_not_sent' then
    if p_actual_input is not null or p_actual_output is not null then
      raise exception using errcode='22023',message='AI_CREDIT_RECONCILIATION_INPUT_INVALID';
    end if;
    -- Release only after the Owner records evidence that the provider never
    -- received the request. If delivery is unknown, leave the reservation held.
    release_monthly:=case when op.credit_cycle_start=w.cycle_start
      then least(op.reserved_monthly,greatest(0,w.monthly_allowance-w.monthly_remaining)) else 0 end;
    release_extra:=op.reserved_extra;
    update public.ai_credit_wallets set monthly_remaining=monthly_remaining+release_monthly,
      extra_balance=extra_balance+release_extra,updated_at=now() where company_id=p_company returning * into w;
    update public.ai_credit_operations set status='released',reconciliation_resolution=p_resolution,
      reconciliation_evidence_ref=safe_evidence,reconciled_by=actor,reconciled_at=now()
      where id=op.id returning * into op;
    insert into public.ai_credit_ledger(company_id,operation_id,user_id,entry_type,monthly_delta,extra_delta,reference_key,details)
      values(p_company,op.id,op.user_id,'release',release_monthly,release_extra,'uncertain-release:'||op.id,
        jsonb_build_object('resolution',p_resolution,'evidence_ref',safe_evidence,'reason',safe_reason))
      on conflict(company_id,entry_type,reference_key) do nothing;
    after_wallet:=to_jsonb(w);
    insert into public.platform_admin_audit_logs(admin_user_id,company_id,action,entity,entity_id,before_data,after_data,reason)
      values(actor,p_company,'ai_credits.operation.reconciled','ai_credit_operations',op.id::text,before_wallet,
        jsonb_build_object('status',op.status,'resolution',p_resolution,'evidence_ref',safe_evidence,'wallet',after_wallet),safe_reason);
    return jsonb_build_object('ok',true,'status','released','released_monthly',release_monthly,'released_extra',release_extra,'duplicate',false);
  end if;

  if p_actual_input is null or p_actual_output is null or p_actual_input<0 or p_actual_output<0
     or p_actual_input>op.max_input_tokens or p_actual_output>op.max_output_tokens then
    raise exception using errcode='22023',message='AI_CREDIT_USAGE_INVALID';
  end if;
  actual_brl:=((op.input_cost_per_1k*p_actual_input+op.output_cost_per_1k*p_actual_output)/1000)
    *coalesce(op.fx_to_brl,0)*op.markup_bps/10000;
  credits_actual:=case when actual_brl=0 then 0 else ceil(actual_brl/op.credit_value_brl)::integer end;
  if credits_actual>op.max_credits then return jsonb_build_object('ok',false,'code','AI_CREDITS_CEILING_BREACHED'); end if;
  monthly_charge:=least(credits_actual,op.reserved_monthly);
  extra_charge:=credits_actual-monthly_charge;
  if extra_charge>op.reserved_extra then return jsonb_build_object('ok',false,'code','AI_CREDIT_RESERVATION_INCONSISTENT'); end if;
  release_monthly:=case when op.credit_cycle_start=w.cycle_start
    then least(op.reserved_monthly-monthly_charge,greatest(0,w.monthly_allowance-w.monthly_remaining)) else 0 end;
  release_extra:=op.reserved_extra-extra_charge;
  update public.ai_credit_wallets set monthly_remaining=monthly_remaining+release_monthly,
    extra_balance=extra_balance+release_extra,updated_at=now() where company_id=p_company returning * into w;
  update public.ai_credit_operations set status='settled',actual_credits=credits_actual,
    actual_input_tokens=p_actual_input,actual_output_tokens=p_actual_output,settled_at=now(),
    reconciliation_resolution=p_resolution,reconciliation_evidence_ref=safe_evidence,reconciled_by=actor,reconciled_at=now()
    where id=op.id returning * into op;
  insert into public.ai_credit_ledger(company_id,operation_id,user_id,entry_type,monthly_delta,extra_delta,reference_key,details)
    values(p_company,op.id,op.user_id,'settlement',-monthly_charge,-extra_charge,'settlement:'||op.id,
      jsonb_build_object('actual_credits',credits_actual,'input_tokens',p_actual_input,'output_tokens',p_actual_output,
        'resolution',p_resolution,'evidence_ref',safe_evidence))
    on conflict(company_id,entry_type,reference_key) do nothing;
  if release_monthly+release_extra>0 then
    insert into public.ai_credit_ledger(company_id,operation_id,user_id,entry_type,monthly_delta,extra_delta,reference_key,details)
      values(p_company,op.id,op.user_id,'release',release_monthly,release_extra,'release:'||op.id,
        jsonb_build_object('reserved',op.max_credits,'actual',credits_actual,'resolution',p_resolution,'evidence_ref',safe_evidence))
      on conflict(company_id,entry_type,reference_key) do nothing;
  end if;
  after_wallet:=to_jsonb(w);
  insert into public.platform_admin_audit_logs(admin_user_id,company_id,action,entity,entity_id,before_data,after_data,reason)
    values(actor,p_company,'ai_credits.operation.reconciled','ai_credit_operations',op.id::text,before_wallet,
      jsonb_build_object('status',op.status,'resolution',p_resolution,'actual_credits',credits_actual,
        'evidence_ref',safe_evidence,'wallet',after_wallet),safe_reason);
  return jsonb_build_object('ok',true,'status','settled','actual_credits',credits_actual,
    'released_monthly',release_monthly,'released_extra',release_extra,'duplicate',false);
end $$;

revoke all on function public.platform_admin_ai_credit_reconcile_uncertain_v1(uuid,uuid,text,integer,integer,text,text) from public,anon,service_role;
grant execute on function public.platform_admin_ai_credit_reconcile_uncertain_v1(uuid,uuid,text,integer,integer,text,text) to authenticated;

comment on function public.platform_admin_ai_credit_reconcile_uncertain_v1(uuid,uuid,text,integer,integer,text,text) is
  'Owner-only audited recovery of reserved/uncertain AI credit operations. Unknown provider outcomes must remain held; release requires evidence no request was sent, settlement requires verified usage.';

create or replace function public.platform_admin_ai_credit_uncertain_list_v1()
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=auth.uid(); rows jsonb;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception using errcode='42501',message='AUTHENTICATED_OWNER_REQUIRED';
  end if;
  if not exists (
    select 1 from public.platform_admins a
    where a.user_id=actor and a.role='owner' and a.status='active' and a.expires_at is null
  ) then raise exception using errcode='42501',message='PLATFORM_OWNER_REQUIRED'; end if;

  select coalesce(jsonb_agg(to_jsonb(pending)), '[]'::jsonb) into rows
  from (
    select id,company_id,model_key,status,max_credits,reserved_monthly,reserved_extra,
      actual_input_tokens,actual_output_tokens,created_at,reserved_at
    from public.ai_credit_operations
    where status in ('reserved','uncertain')
    order by created_at asc
    limit 100
  ) pending;
  return jsonb_build_object('rows',rows);
end $$;

revoke all on function public.platform_admin_ai_credit_uncertain_list_v1() from public,anon,service_role;
grant execute on function public.platform_admin_ai_credit_uncertain_list_v1() to authenticated;
comment on function public.platform_admin_ai_credit_uncertain_list_v1() is
  'Owner-only read of limited metadata for pending AI credit reservations; does not expose prompts, credentials, or provider response bodies.';
