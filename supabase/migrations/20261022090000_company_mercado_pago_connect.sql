-- Company-owned Mercado Pago OAuth connections and payment attempt ledger.
-- SaaS subscription billing remains in billing_* and uses platform credentials.
create table if not exists public.company_mp_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  seller_id text not null check (seller_id ~ '^[0-9]{3,24}$'),
  status text not null default 'connected' check (status in ('connected','disconnected','reauthorization_required','error')),
  scopes text[] not null default '{}',
  public_key text,
  secret_id uuid,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  access_token_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id)
);
alter table public.company_mp_connections enable row level security;
drop policy if exists company_mp_connections_select on public.company_mp_connections;
create policy company_mp_connections_select on public.company_mp_connections for select to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','financeiro'));
revoke all on public.company_mp_connections from public, anon, authenticated;
grant select(id,company_id,seller_id,status,scopes,public_key,connected_by,connected_at,disconnected_at,access_token_expires_at,last_error_code,created_at,updated_at) on public.company_mp_connections to authenticated;
revoke all on public.company_mp_connections from service_role;
grant select,insert,update,delete on public.company_mp_connections to service_role;

create table if not exists public.company_mp_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pkce_verifier text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
alter table public.company_mp_oauth_states enable row level security;
revoke all on public.company_mp_oauth_states from public, anon, authenticated;
grant all on public.company_mp_oauth_states to service_role;

-- sales.id is globally unique, but the tenant-bearing composite FK is required
-- to make the ledger's company/sale relationship enforceable by the database.
create unique index if not exists sales_company_id_id_uidx on public.sales(company_id,id);

create table if not exists public.company_mp_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  connection_id uuid not null,
  sale_id uuid not null,
  financial_entry_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 16 and 100),
  provider_payment_id text,
  provider_preference_id text,
  provider_status text,
  method text not null check (method in ('pix','card')),
  status text not null default 'creating' check (status in ('creating','pending','approved','rejected','cancelled','expired','refunded','charged_back','uncertain','failed')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  installments integer not null default 1 check (installments between 1 and 24),
  fee_amount numeric(14,2),
  net_amount numeric(14,2),
  pix_qr_code text,
  pix_qr_code_base64 text,
  pix_ticket_url text,
  checkout_url text,
  expires_at timestamptz,
  refunded_amount numeric(14,2) not null default 0 check (refunded_amount >= 0),
  last_synced_at timestamptz,
  safe_error_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,idempotency_key),
  unique(connection_id,provider_payment_id),
  foreign key(company_id,connection_id) references public.company_mp_connections(company_id,id),
  foreign key(company_id,sale_id) references public.sales(company_id,id),
  foreign key(company_id,financial_entry_id) references public.financial_entries(company_id,id)
);
create index if not exists company_mp_payments_sale_history on public.company_mp_payments(company_id,sale_id,created_at desc);
create index if not exists company_mp_payments_status_sync on public.company_mp_payments(status,updated_at) where status in ('creating','pending','uncertain');
create unique index if not exists company_mp_payments_one_open_attempt on public.company_mp_payments(company_id,sale_id) where status in ('creating','pending','uncertain');
alter table public.company_mp_payments enable row level security;
drop policy if exists company_mp_payments_select on public.company_mp_payments;
create policy company_mp_payments_select on public.company_mp_payments for select to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','financeiro','comercial','vendedor'));
revoke all on public.company_mp_payments from public, anon, authenticated;
grant select on public.company_mp_payments to authenticated;
revoke all on public.company_mp_payments from service_role;
grant select,insert,update,delete on public.company_mp_payments to service_role;

create table if not exists public.company_mp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_key text not null unique,
  payment_id uuid,
  company_id uuid,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  safe_error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.company_mp_webhook_events enable row level security;
revoke all on public.company_mp_webhook_events from public, anon, authenticated;
grant all on public.company_mp_webhook_events to service_role;

create or replace function public.company_mp_consume_oauth_state(p_state_hash text)
returns table(company_id uuid,user_id uuid,pkce_verifier text)
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  return query update public.company_mp_oauth_states s set consumed_at=now()
    where s.state_hash=p_state_hash and s.consumed_at is null and s.expires_at>now()
    returning s.company_id,s.user_id,s.pkce_verifier;
end; $$;
revoke all on function public.company_mp_consume_oauth_state(text) from public,anon,authenticated;
grant execute on function public.company_mp_consume_oauth_state(text) to service_role;

create or replace function public.company_mp_save_connection(
  p_company uuid,p_seller text,p_scopes text[],p_public_key text,p_access_token text,p_refresh_token text,p_expires_at timestamptz,p_connected_by uuid
) returns public.company_mp_connections
language plpgsql security definer set search_path=pg_catalog,public,vault,pg_temp as $$
declare previous public.company_mp_connections; result public.company_mp_connections; new_secret uuid;
begin
  if p_seller !~ '^[0-9]{3,24}$' or length(p_access_token)<16 or length(p_refresh_token)<16 then raise exception 'MP_TOKEN_RESPONSE_INVALID'; end if;
  select * into previous from public.company_mp_connections where company_id=p_company for update;
  if previous.id is not null and previous.seller_id<>p_seller and exists(
    select 1 from public.company_mp_payments where company_id=p_company and connection_id=previous.id and status in ('creating','pending','uncertain')
  ) then raise exception 'MP_PENDING_PAYMENT_PREVENTS_ACCOUNT_CHANGE'; end if;
  new_secret := vault.create_secret(jsonb_build_object('access_token',p_access_token,'refresh_token',p_refresh_token)::text,
    'company-mp-'||gen_random_uuid()::text,'F7 company Mercado Pago OAuth tokens');
  insert into public.company_mp_connections(company_id,seller_id,status,scopes,public_key,secret_id,connected_by,connected_at,disconnected_at,access_token_expires_at,last_error_code)
  values(p_company,p_seller,'connected',coalesce(p_scopes,'{}'),nullif(p_public_key,''),new_secret,p_connected_by,now(),null,p_expires_at,null)
  on conflict(company_id) do update set seller_id=excluded.seller_id,status='connected',scopes=excluded.scopes,public_key=excluded.public_key,
    secret_id=excluded.secret_id,connected_by=excluded.connected_by,connected_at=now(),disconnected_at=null,
    access_token_expires_at=excluded.access_token_expires_at,last_error_code=null,updated_at=now()
  returning * into result;
  if previous.secret_id is not null then delete from vault.secrets where id=previous.secret_id; end if;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
    values(p_company,p_connected_by,'payment_provider.mercado_pago_connected','CompanyMpConnection',result.id,jsonb_build_object('seller_id',p_seller,'tokens_stored_in_vault',true));
  return result;
end; $$;
revoke all on function public.company_mp_save_connection(uuid,text,text[],text,text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.company_mp_save_connection(uuid,text,text[],text,text,text,timestamptz,uuid) to service_role;

create or replace function public.company_mp_refresh_connection(p_company uuid,p_access_token text,p_refresh_token text,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,vault,pg_temp as $$
declare account public.company_mp_connections;
begin
  select * into account from public.company_mp_connections where company_id=p_company and status='connected' for update;
  if account.id is null or account.secret_id is null or length(p_access_token)<16 or length(p_refresh_token)<16 then return false; end if;
  perform vault.update_secret(account.secret_id,jsonb_build_object('access_token',p_access_token,'refresh_token',p_refresh_token)::text,
    'company-mp-'||gen_random_uuid()::text,'F7 company Mercado Pago OAuth tokens');
  update public.company_mp_connections set access_token_expires_at=p_expires_at,last_error_code=null,updated_at=now() where id=account.id;
  return true;
end; $$;
revoke all on function public.company_mp_refresh_connection(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.company_mp_refresh_connection(uuid,text,text,timestamptz) to service_role;

create or replace function public.company_mp_disconnect(p_company uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,vault,pg_temp as $$
declare actor uuid:=auth.uid(); account public.company_mp_connections;
begin
  if actor is null or not public.is_company_member(p_company) or public.current_company_role(p_company) not in ('admin','gestor','financeiro') then raise exception 'MP_DISCONNECT_FORBIDDEN'; end if;
  select * into account from public.company_mp_connections where company_id=p_company for update;
  if account.id is null or account.status='disconnected' then return true; end if;
  if exists(select 1 from public.company_mp_payments where company_id=p_company and connection_id=account.id and status in ('creating','pending','uncertain')) then raise exception 'MP_PENDING_PAYMENT_PREVENTS_DISCONNECT'; end if;
  update public.company_mp_connections set status='disconnected',secret_id=null,disconnected_at=now(),updated_at=now() where id=account.id;
  if account.secret_id is not null then delete from vault.secrets where id=account.secret_id; end if;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data)
    values(p_company,actor,'payment_provider.mercado_pago_disconnected','CompanyMpConnection',account.id,
      jsonb_build_object('seller_id',account.seller_id,'status',account.status),jsonb_build_object('status','disconnected','local_tokens_revoked',true));
  return true;
end; $$;
revoke all on function public.company_mp_disconnect(uuid) from public,anon;
grant execute on function public.company_mp_disconnect(uuid) to authenticated;

create or replace function public.company_mp_create_payment_attempt(p_company uuid,p_sale uuid,p_method text,p_installments integer,p_idempotency text)
returns public.company_mp_payments language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=auth.uid(); sale_row public.sales; entry public.financial_entries; conn public.company_mp_connections; result public.company_mp_payments;
begin
  if actor is null or not public.is_company_member(p_company) or public.current_company_role(p_company) not in ('admin','gestor','financeiro','comercial','vendedor') then raise exception 'MP_PAYMENT_FORBIDDEN'; end if;
  if p_method not in ('pix','card') or p_installments not between 1 and 24 or length(p_idempotency) not between 16 and 100 then raise exception 'MP_PAYMENT_INPUT_INVALID'; end if;
  select * into result from public.company_mp_payments where company_id=p_company and idempotency_key=p_idempotency;
  if result.id is not null then
    if result.sale_id<>p_sale or result.method<>p_method then raise exception 'MP_IDEMPOTENCY_KEY_REUSED'; end if;
    return result;
  end if;
  select * into result from public.company_mp_payments where company_id=p_company and sale_id=p_sale and status in ('creating','pending','uncertain') for update;
  if result.id is not null then
    if result.method<>p_method then raise exception 'MP_PAYMENT_ATTEMPT_PENDING'; end if;
    return result;
  end if;
  select * into conn from public.company_mp_connections where company_id=p_company and status='connected';
  if conn.id is null then raise exception 'MP_COMPANY_ACCOUNT_NOT_CONNECTED'; end if;
  select * into sale_row from public.sales where id=p_sale and company_id=p_company for update;
  if sale_row.id is null or sale_row.status<>'completed' then raise exception 'MP_SALE_NOT_BILLED'; end if;
  select * into entry from public.financial_entries where sale_id=sale_row.id and company_id=p_company and type='receivable' order by created_at desc limit 1 for update;
  if entry.id is null or entry.status not in ('pending','partial') or entry.received_amount<>0 then raise exception 'MP_RECEIVABLE_NOT_PAYABLE'; end if;
  if p_method='pix' and p_installments<>1 then raise exception 'MP_PIX_INSTALLMENTS_INVALID'; end if;
  insert into public.company_mp_payments(company_id,connection_id,sale_id,financial_entry_id,idempotency_key,method,status,amount,currency,installments,created_by)
  values(p_company,conn.id,sale_row.id,entry.id,p_idempotency,p_method,'creating',round(entry.total_amount-entry.received_amount,2),'BRL',p_installments,actor)
  returning * into result;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
    values(p_company,actor,'payment_provider.mercado_pago_attempt_created','CompanyMpPayment',result.id,jsonb_build_object('sale_id',sale_row.id,'amount',result.amount,'method',p_method,'currency','BRL'));
  return result;
end; $$;
revoke all on function public.company_mp_create_payment_attempt(uuid,uuid,text,integer,text) from public,anon;
grant execute on function public.company_mp_create_payment_attempt(uuid,uuid,text,integer,text) to authenticated;

create or replace function public.company_mp_save_payment_provider_result(p_payment uuid,p_company uuid,p_provider_payment text,p_preference text,p_provider_status text,p_pix_qr text,p_pix_base64 text,p_pix_ticket text,p_checkout_url text,p_expires_at timestamptz,p_error text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.company_mp_payments set provider_payment_id=coalesce(nullif(p_provider_payment,''),provider_payment_id),
    provider_preference_id=coalesce(nullif(p_preference,''),provider_preference_id),provider_status=coalesce(nullif(p_provider_status,''),provider_status),
    pix_qr_code=coalesce(nullif(p_pix_qr,''),pix_qr_code),pix_qr_code_base64=coalesce(nullif(p_pix_base64,''),pix_qr_code_base64),pix_ticket_url=coalesce(nullif(p_pix_ticket,''),pix_ticket_url),
    checkout_url=coalesce(nullif(p_checkout_url,''),checkout_url),expires_at=coalesce(p_expires_at,expires_at),safe_error_code=nullif(p_error,''),
    status=case when p_error is not null then 'uncertain' else 'pending' end,
    updated_at=now() where id=p_payment and company_id=p_company and status in ('creating','uncertain','pending');
  return found;
end; $$;
revoke all on function public.company_mp_save_payment_provider_result(uuid,uuid,text,text,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.company_mp_save_payment_provider_result(uuid,uuid,text,text,text,text,text,text,text,timestamptz,text) to service_role;

create or replace function public.company_mp_get_payment_server(p_payment uuid)
returns table(payment public.company_mp_payments, seller_id text, public_key text, vault_secret jsonb)
language sql stable security definer set search_path=pg_catalog,public,vault,pg_temp as $$
  select p,c.seller_id,c.public_key,coalesce(sec.decrypted_secret::jsonb,'{}'::jsonb)
  from public.company_mp_payments p join public.company_mp_connections c on c.id=p.connection_id and c.company_id=p.company_id
  left join vault.decrypted_secrets sec on sec.id=c.secret_id where p.id=p_payment;
$$;
revoke all on function public.company_mp_get_payment_server(uuid) from public,anon,authenticated;
grant execute on function public.company_mp_get_payment_server(uuid) to service_role;

create or replace function public.company_mp_get_connection_server(p_connection uuid)
returns table(connection public.company_mp_connections, vault_secret jsonb)
language sql stable security definer set search_path=pg_catalog,public,vault,pg_temp as $$
  select c,coalesce(sec.decrypted_secret::jsonb,'{}'::jsonb) from public.company_mp_connections c
  left join vault.decrypted_secrets sec on sec.id=c.secret_id where c.id=p_connection and c.status='connected';
$$;
revoke all on function public.company_mp_get_connection_server(uuid) from public,anon,authenticated;
grant execute on function public.company_mp_get_connection_server(uuid) to service_role;

create or replace function public.company_mp_apply_provider_status(p_payment uuid,p_company uuid,p_provider_payment text,p_provider_status text,p_amount numeric,p_currency text,p_fee numeric,p_net numeric,p_refunded numeric,p_event_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare payment public.company_mp_payments; entry public.financial_entries; installment public.financial_installments; refund_installment public.financial_installments; status_value text; previous_status text; previous_refunded numeric(14,2); refund_remaining numeric(14,2); refund_piece numeric(14,2);
begin
  insert into public.company_mp_webhook_events(provider_event_key,payment_id,company_id) values(p_event_key,p_payment,p_company)
    on conflict(provider_event_key) do nothing;
  if not found then return jsonb_build_object('code','DUPLICATE'); end if;
  select * into payment from public.company_mp_payments where id=p_payment and company_id=p_company for update;
  if payment.id is null or payment.provider_payment_id is distinct from p_provider_payment then
    update public.company_mp_webhook_events set status='ignored',safe_error_code='PAYMENT_ID_MISMATCH',processed_at=now() where provider_event_key=p_event_key;
    return jsonb_build_object('code','MISMATCH');
  end if;
  if p_amount is null or round(p_amount,2)<>payment.amount or upper(coalesce(p_currency,''))<>'BRL' then
    update public.company_mp_webhook_events set status='ignored',safe_error_code='AMOUNT_CURRENCY_MISMATCH',processed_at=now() where provider_event_key=p_event_key;
    return jsonb_build_object('code','MISMATCH');
  end if;
  status_value := case p_provider_status when 'approved' then 'approved' when 'rejected' then 'rejected' when 'cancelled' then 'cancelled' when 'refunded' then 'refunded' when 'charged_back' then 'charged_back' when 'expired' then 'expired' else 'pending' end;
  previous_status := payment.status;
  previous_refunded := payment.refunded_amount;
  update public.company_mp_payments set status=status_value,provider_status=p_provider_status,fee_amount=greatest(coalesce(p_fee,0),0),net_amount=greatest(coalesce(p_net,0),0),refunded_amount=case when p_provider_status='charged_back' then payment.amount else least(payment.amount,greatest(payment.refunded_amount,coalesce(p_refunded,0))) end,last_synced_at=now(),updated_at=now() where id=payment.id returning * into payment;
  if status_value='approved' and previous_status<>'approved' then
    select * into entry from public.financial_entries where id=payment.financial_entry_id and company_id=payment.company_id for update;
    if entry.id is null or entry.status='cancelled' then raise exception 'MP_RECEIVABLE_NOT_SETTLEABLE'; end if;
    if not exists(select 1 from public.financial_movements where company_id=payment.company_id and idempotency_key='mp-payment:'||payment.id::text) then
      for installment in select * from public.financial_installments where financial_entry_id=entry.id and company_id=entry.company_id and status in ('pending','partial') order by installment_number for update loop
        update public.financial_installments set received_amount=amount,status='received' where id=installment.id;
      end loop;
      insert into public.financial_movements(company_id,financial_entry_id,installment_id,direction,amount,payment_method,account,occurred_at,idempotency_key)
      values(payment.company_id,entry.id,null,'in',payment.amount,'Mercado Pago · '||payment.method,'Mercado Pago',now(),'mp-payment:'||payment.id::text);
      update public.financial_entries set received_amount=received_amount+payment.amount,status=case when received_amount+payment.amount>=total_amount then 'received' else 'partial' end,paid_date=current_date,paid_at=now(),payment_method='Mercado Pago · '||payment.method where id=entry.id and company_id=entry.company_id;
      insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
        values(payment.company_id,null,'finance.mercado_pago_payment_confirmed','FinancialEntry',entry.id,jsonb_build_object('payment_id',payment.id,'provider_payment_id',p_provider_payment,'amount',payment.amount,'fee_amount',payment.fee_amount,'net_amount',payment.net_amount));
    end if;
  end if;
  if previous_status='approved' and payment.refunded_amount > previous_refunded then
    select * into entry from public.financial_entries where id=payment.financial_entry_id and company_id=payment.company_id for update;
    if entry.id is not null and entry.received_amount > 0 then
      refund_remaining := least(entry.received_amount,payment.refunded_amount-previous_refunded);
      update public.financial_entries set received_amount=greatest(0,received_amount-refund_remaining),
        status=case when greatest(0,received_amount-refund_remaining)=0 then 'pending' else 'partial' end,
        paid_date=null,paid_at=null,payment_method='Mercado Pago · estorno'
        where id=entry.id and company_id=payment.company_id;
      for refund_installment in select * from public.financial_installments where financial_entry_id=entry.id and company_id=payment.company_id and received_amount>0 order by installment_number desc for update loop
        exit when refund_remaining<=0;
        refund_piece := least(refund_installment.received_amount,refund_remaining);
        update public.financial_installments set received_amount=received_amount-refund_piece,
          status=case when received_amount-refund_piece<=0 then 'pending' when received_amount-refund_piece>=amount then 'received' else 'partial' end where id=refund_installment.id;
        refund_remaining := refund_remaining-refund_piece;
      end loop;
      insert into public.financial_movements(company_id,financial_entry_id,installment_id,direction,amount,payment_method,account,occurred_at,idempotency_key)
        values(payment.company_id,entry.id,null,'out',least(entry.received_amount,payment.refunded_amount-previous_refunded),'Estorno Mercado Pago · '||payment.method,'Mercado Pago',now(),'mp-refund:'||p_event_key)
        on conflict(company_id,idempotency_key) do nothing;
      insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
        values(payment.company_id,null,'finance.mercado_pago_payment_refunded','FinancialEntry',entry.id,jsonb_build_object('payment_id',payment.id,'provider_payment_id',p_provider_payment,'amount',payment.amount,'refunded_amount',p_refunded,'provider_status',p_provider_status));
    end if;
  end if;
  update public.company_mp_webhook_events set status='processed',processed_at=now() where provider_event_key=p_event_key;
  return jsonb_build_object('code','OK','status',status_value,'payment_id',payment.id);
end; $$;
revoke all on function public.company_mp_apply_provider_status(uuid,uuid,text,text,numeric,text,numeric,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.company_mp_apply_provider_status(uuid,uuid,text,text,numeric,text,numeric,numeric,numeric,text) to service_role;

create or replace function public.prevent_sale_cancel_with_open_mp_payment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if new.status='cancelled' and old.status is distinct from new.status and exists(
    select 1 from public.company_mp_payments p where p.company_id=old.company_id and p.sale_id=old.id and p.status in ('creating','pending','uncertain')
  ) then raise exception 'MP_PAYMENT_PENDING_PREVENTS_SALE_CANCEL'; end if;
  return new;
end; $$;
revoke all on function public.prevent_sale_cancel_with_open_mp_payment() from public,anon,authenticated;
drop trigger if exists sales_prevent_cancel_open_mp_payment on public.sales;
create trigger sales_prevent_cancel_open_mp_payment before update of status on public.sales
for each row execute function public.prevent_sale_cancel_with_open_mp_payment();

comment on table public.company_mp_connections is 'Per-company Mercado Pago OAuth connection. OAuth credentials are stored only in Supabase Vault.';
comment on table public.company_mp_payments is 'Company marketplace payment ledger; separate from SaaS billing_payments.';
