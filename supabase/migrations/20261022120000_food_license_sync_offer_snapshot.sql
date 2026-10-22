begin;

-- Conceptual rollback: restore the prior enqueue-trigger body after stopping
-- new license writes; preserve every queued delivery and audit record.

create or replace function public.product_enqueue_food_license_delivery()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare offer_row public.product_offers; delivery_event uuid; mapped_status text; payload jsonb;
begin
  if new.product_key <> 'f7_food' or new.food_company_id is null then return new; end if;
  if tg_op='UPDATE' and row(new.commercial_account_id,new.product_key,new.offer_id,new.status,new.starts_at,new.ends_at,new.food_company_id)
      is not distinct from row(old.commercial_account_id,old.product_key,old.offer_id,old.status,old.starts_at,old.ends_at,old.food_company_id) then
    return new;
  end if;
  select * into offer_row from public.product_offers where id=new.offer_id and product_key='f7_food' for share;
  if offer_row.id is null then raise exception using errcode='23503',message='FOOD_OFFER_NOT_FOUND'; end if;
  mapped_status := case new.status when 'past_due' then 'suspended' else new.status end;
  if mapped_status not in ('trial','active','suspended','expired','cancelled') then
    raise exception using errcode='22023',message='FOOD_LICENSE_STATUS_NOT_SUPPORTED';
  end if;
  delivery_event := gen_random_uuid();
  payload := jsonb_build_object('source_system','f7_business','event_id',delivery_event,
    'license_id',new.id,'company_id',new.food_company_id,'product_key','f7_food',
    'offer_id',offer_row.id,'plan_code',offer_row.offer_code,'plan_name',offer_row.name,
    'price_minor',offer_row.price_minor,'billing_period',offer_row.billing_period,
    'trial_days',coalesce(offer_row.trial_days,0),'plan_active',offer_row.active,
    'status',mapped_status,'starts_at',new.starts_at,'ends_at',new.ends_at,
    'reason','Commercial F7 Business license update');
  insert into public.product_license_delivery_outbox(id,license_id,commercial_account_id,food_company_id,event_payload)
    values(delivery_event,new.id,new.commercial_account_id,new.food_company_id,payload);
  return new;
end $$;
revoke all on function public.product_enqueue_food_license_delivery() from public,anon,authenticated;

commit;
