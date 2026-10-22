begin;

-- Conceptual rollback: stop dispatcher calls and revoke the result RPC; retain
-- outbox and attempt history, then restore the previous dispatcher atomically.

create or replace function public.product_license_delivery_record_result(
  p_outbox_id uuid,
  p_attempt_number integer,
  p_result text,
  p_http_status integer default null,
  p_error_code text default null,
  p_remote_license_id uuid default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare row_value public.product_license_delivery_outbox;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_outbox_id is null or p_attempt_number is null or p_attempt_number<1
     or p_result not in ('delivered','retry','blocked') then
    raise exception using errcode='22023',message='PRODUCT_LICENSE_DELIVERY_RESULT_INVALID';
  end if;
  select * into row_value from public.product_license_delivery_outbox
    where id=p_outbox_id for update;
  if row_value.id is null or row_value.status<>'processing' or row_value.attempts<>p_attempt_number then
    raise exception using errcode='40001',message='PRODUCT_LICENSE_DELIVERY_LEASE_MISMATCH';
  end if;
  update public.product_license_delivery_outbox set status=p_result,
    lease_until=null,last_http_status=p_http_status,
    last_error=case when p_result='delivered' then null else left(coalesce(p_error_code,'DELIVERY_FAILED'),180) end,
    remote_license_id=coalesce(p_remote_license_id,remote_license_id),
    delivered_at=case when p_result='delivered' then now() else null end,
    next_attempt_at=case when p_result='retry'
      then now()+least(interval '24 hours',interval '30 seconds'*power(2,least(p_attempt_number-1,10)))
      else next_attempt_at end,
    updated_at=now()
    where id=p_outbox_id returning * into row_value;
  insert into public.product_license_delivery_attempts(
    outbox_id,attempt_number,result,http_status,remote_license_id,error_code
  ) values(p_outbox_id,p_attempt_number,p_result,p_http_status,p_remote_license_id,
    case when p_result='delivered' then null else left(coalesce(p_error_code,'DELIVERY_FAILED'),120) end);
  return jsonb_build_object('id',row_value.id,'status',row_value.status,'attempts',row_value.attempts);
end;
$$;
revoke all on function public.product_license_delivery_record_result(uuid,integer,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.product_license_delivery_record_result(uuid,integer,text,integer,text,uuid) to service_role;

commit;
