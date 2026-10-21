-- Conceptual rollback: disable receiving-account selection first, export and
-- preserve linked financial history, remove the new triggers/functions/FKs,
-- then drop only the new account table and added account-id columns. Do not
-- delete bank-account audit records or financial history as part of rollback.
-- Tenant-owned receiving accounts. Sensitive fields are kept in Vault as one
-- encrypted JSON secret; this table stores only account metadata and its UUID.
create table if not exists public.company_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null check (length(trim(label)) between 2 and 80),
  institution_name text not null check (length(trim(institution_name)) between 2 and 120),
  bank_code text check (bank_code is null or bank_code ~ '^[0-9]{3}$'),
  ispb text check (ispb is null or ispb ~ '^[0-9]{8}$'),
  account_type text not null default 'checking' check (account_type in ('checking','savings','payment')),
  secret_id uuid not null,
  merchant_city text,
  integration_provider text not null default 'manual' check (integration_provider = 'manual'),
  connection_status text not null default 'manual' check (connection_status = 'manual'),
  active boolean not null default true,
  is_primary boolean not null default false,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, id),
  check (not is_primary or active)
);

create unique index if not exists company_bank_accounts_one_primary
  on public.company_bank_accounts(company_id) where is_primary and active;
create index if not exists company_bank_accounts_company_active
  on public.company_bank_accounts(company_id, active, is_primary, created_at desc);

alter table public.company_bank_accounts enable row level security;
revoke all on public.company_bank_accounts from public, anon, service_role;
grant select on public.company_bank_accounts to authenticated;
create policy company_bank_accounts_finance_read on public.company_bank_accounts
  for select to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','financeiro'));
create or replace function public.audit_company_bank_account_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare old_safe jsonb; new_safe jsonb; action_name text;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  if tg_op <> 'INSERT' then
    old_safe := jsonb_build_object('id',old.id,'label',old.label,'institution_name',old.institution_name,
      'bank_code',old.bank_code,'account_type',old.account_type,'active',old.active,'is_primary',old.is_primary,
      'integration_provider',old.integration_provider,'connection_status',old.connection_status);
  end if;
  if tg_op <> 'DELETE' then
    new.updated_at := now(); new.updated_by := auth.uid();
    new_safe := jsonb_build_object('id',new.id,'label',new.label,'institution_name',new.institution_name,
      'bank_code',new.bank_code,'account_type',new.account_type,'active',new.active,'is_primary',new.is_primary,
      'integration_provider',new.integration_provider,'connection_status',new.connection_status,
      'secret_changed',case when tg_op='UPDATE' then old.secret_id is distinct from new.secret_id else true end);
  end if;
  action_name := case when tg_op='INSERT' then 'bank_account.created' when tg_op='DELETE' then 'bank_account.deleted' else 'bank_account.updated' end;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data)
    values(coalesce(new.company_id,old.company_id),auth.uid(),action_name,'CompanyBankAccount',coalesce(new.id,old.id),old_safe,new_safe);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_company_bank_account_change() from public, anon, authenticated, service_role;
create trigger company_bank_accounts_audit before insert or update or delete
  on public.company_bank_accounts for each row execute function public.audit_company_bank_account_change();

create or replace function public.save_company_bank_account(
  target_company uuid, account_metadata jsonb, sensitive_fields jsonb, target_account uuid default null
) returns public.company_bank_accounts language plpgsql security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
declare actor uuid := auth.uid(); role_name text; secret_uuid uuid; row_result public.company_bank_accounts;
begin
  if actor is null or not public.is_company_member(target_company) then raise exception 'Empresa não encontrada'; end if;
  role_name := public.current_company_role(target_company);
  if role_name not in ('admin','gestor','financeiro') then raise exception 'Sem permissão para gerenciar contas bancárias'; end if;
  if account_metadata->>'label' is null or length(trim(account_metadata->>'label')) not between 2 and 80 then raise exception 'Nome da conta inválido'; end if;
  if account_metadata->>'institution_name' is null or length(trim(account_metadata->>'institution_name')) not between 2 and 120 then raise exception 'Instituição inválida'; end if;
  if coalesce(sensitive_fields->>'pix_key_type','') not in ('','cpf','cnpj','email','phone','random') then raise exception 'Tipo de chave Pix inválido'; end if;
  if coalesce(sensitive_fields->>'pix_key_type','') <> '' and nullif(trim(sensitive_fields->>'pix_key'),'') is null then raise exception 'Chave Pix ausente'; end if;

  if target_account is null then
    secret_uuid := vault.create_secret(coalesce(sensitive_fields,'{}'::jsonb)::text,
      'company-bank-account-'||gen_random_uuid()::text, 'F7 tenant bank account sensitive fields');
    insert into public.company_bank_accounts(company_id,label,institution_name,bank_code,ispb,account_type,
      secret_id,merchant_city,integration_provider,connection_status,active,is_primary,created_by,updated_by)
    values(target_company,trim(account_metadata->>'label'),trim(account_metadata->>'institution_name'),
      nullif(account_metadata->>'bank_code',''),nullif(account_metadata->>'ispb',''),
      coalesce(nullif(account_metadata->>'account_type',''),'checking'),secret_uuid,
      nullif(trim(account_metadata->>'merchant_city'),''),'manual','manual',coalesce((account_metadata->>'active')::boolean,true),false,actor,actor)
      returning * into row_result;
    insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
      values(target_company,actor,'bank_account.secret_created','CompanyBankAccount',row_result.id,jsonb_build_object('secret_stored_in_vault',true));
  else
    select * into row_result from public.company_bank_accounts where id=target_account and company_id=target_company for update;
    if row_result.id is null then raise exception 'Conta bancária não encontrada'; end if;
    if sensitive_fields is not null then
      perform vault.update_secret(row_result.secret_id,sensitive_fields::text,
        'company-bank-account-'||gen_random_uuid()::text,'F7 tenant bank account sensitive fields');
      insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
        values(target_company,actor,'bank_account.secret_updated','CompanyBankAccount',row_result.id,jsonb_build_object('secret_stored_in_vault',true));
    end if;
    update public.company_bank_accounts set label=trim(account_metadata->>'label'),
      institution_name=trim(account_metadata->>'institution_name'),bank_code=nullif(account_metadata->>'bank_code',''),
      ispb=nullif(account_metadata->>'ispb',''),account_type=coalesce(nullif(account_metadata->>'account_type',''),'checking'),
      merchant_city=nullif(trim(account_metadata->>'merchant_city'),''),
      active=coalesce((account_metadata->>'active')::boolean,active),
      is_primary=case when coalesce((account_metadata->>'active')::boolean,active) then is_primary else false end,
      updated_by=actor where id=target_account returning * into row_result;
  end if;
  return row_result;
end;
$$;
revoke all on function public.save_company_bank_account(uuid,jsonb,jsonb,uuid) from public, anon, service_role;
grant execute on function public.save_company_bank_account(uuid,jsonb,jsonb,uuid) to authenticated;

create or replace function public.get_company_bank_account_secret(target_account uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
declare account_row public.company_bank_accounts; secret_value text;
begin
  select * into account_row from public.company_bank_accounts where id=target_account and public.is_company_member(company_id);
  if account_row.id is null or public.current_company_role(account_row.company_id) not in ('admin','gestor','financeiro') then raise exception 'Conta não encontrada ou sem permissão'; end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=account_row.secret_id;
  return coalesce(secret_value::jsonb,'{}'::jsonb);
end;
$$;
revoke all on function public.get_company_bank_account_secret(uuid) from public, anon, service_role;
grant execute on function public.get_company_bank_account_secret(uuid) to authenticated;

create or replace function public.set_primary_company_bank_account(target_account uuid)
returns public.company_bank_accounts language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare account_row public.company_bank_accounts;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into account_row from public.company_bank_accounts
    where id=target_account and public.is_company_member(company_id) and active for update;
  if account_row.id is null then raise exception 'Conta ativa não encontrada'; end if;
  if public.current_company_role(account_row.company_id) not in ('admin','gestor','financeiro') then raise exception 'Sem permissão para definir conta principal'; end if;
  update public.company_bank_accounts set is_primary=false,updated_by=auth.uid()
    where company_id=account_row.company_id and is_primary and id<>account_row.id;
  update public.company_bank_accounts set is_primary=true,updated_by=auth.uid()
    where id=account_row.id returning * into account_row;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
    values(account_row.company_id,auth.uid(),'bank_account.primary_changed','CompanyBankAccount',account_row.id,
      jsonb_build_object('id',account_row.id,'label',account_row.label,'is_primary',true));
  return account_row;
end;
$$;
revoke all on function public.set_primary_company_bank_account(uuid) from public, anon, service_role;
grant execute on function public.set_primary_company_bank_account(uuid) to authenticated;

create or replace function public.list_company_bank_accounts(target_company uuid)
returns table(
  id uuid,label text,institution_name text,bank_code text,account_type text,agency text,
  account_last4 text,holder_name text,holder_document_last4 text,merchant_city text,
  pix_key_type text,pix_key_last4 text,is_primary boolean,active boolean
) language plpgsql stable security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_company_member(target_company) then raise exception 'Empresa não encontrada'; end if;
  if public.current_company_role(target_company) not in ('admin','gestor','financeiro') then raise exception 'Sem permissão para consultar dados bancários'; end if;
  return query select a.id,a.label,a.institution_name,a.bank_code,a.account_type,
    nullif(sec.decrypted_secret::jsonb->>'agency',''),
    case when sec.decrypted_secret::jsonb->>'account_number' is null then null else right(sec.decrypted_secret::jsonb->>'account_number',4) end,
    nullif(sec.decrypted_secret::jsonb->>'holder_name',''),
    case when sec.decrypted_secret::jsonb->>'holder_document' is null then null else right(regexp_replace(sec.decrypted_secret::jsonb->>'holder_document','[^0-9]','','g'),4) end,
    a.merchant_city,nullif(sec.decrypted_secret::jsonb->>'pix_key_type',''),
    case when sec.decrypted_secret::jsonb->>'pix_key' is null then null else right(sec.decrypted_secret::jsonb->>'pix_key',4) end,
    a.is_primary,a.active
  from public.company_bank_accounts a join vault.decrypted_secrets sec on sec.id=a.secret_id
  where a.company_id=target_company order by a.is_primary desc,a.label asc;
end;
$$;
revoke all on function public.list_company_bank_accounts(uuid) from public, anon, service_role;
grant execute on function public.list_company_bank_accounts(uuid) to authenticated;

create or replace function public.list_company_receiving_accounts(target_company uuid)
returns table(
  id uuid, label text, institution_name text, bank_code text, account_type text,
  holder_name text, merchant_city text, pix_key_type text, pix_key text, is_primary boolean
) language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_company_member(target_company) then raise exception 'Empresa não encontrada'; end if;
  if public.current_company_role(target_company) not in ('admin','gestor','financeiro','comercial','vendedor') then raise exception 'Sem permissão para consultar contas de recebimento'; end if;
  return query select a.id,a.label,a.institution_name,a.bank_code,a.account_type,
    nullif(sec.decrypted_secret::jsonb->>'holder_name',''),a.merchant_city,
    nullif(sec.decrypted_secret::jsonb->>'pix_key_type',''),nullif(sec.decrypted_secret::jsonb->>'pix_key',''),a.is_primary
    from public.company_bank_accounts a join vault.decrypted_secrets sec on sec.id=a.secret_id
    where a.company_id=target_company and a.active
    order by a.is_primary desc,a.label asc;
end;
$$;
revoke all on function public.list_company_receiving_accounts(uuid) from public, anon, service_role;
grant execute on function public.list_company_receiving_accounts(uuid) to authenticated;

alter table public.sales add column if not exists bank_account_id uuid;
alter table public.financial_entries add column if not exists bank_account_id uuid;
alter table public.financial_movements add column if not exists bank_account_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='sales_company_bank_account_fk') then
    alter table public.sales add constraint sales_company_bank_account_fk foreign key(company_id,bank_account_id) references public.company_bank_accounts(company_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='financial_entries_company_bank_account_fk') then
    alter table public.financial_entries add constraint financial_entries_company_bank_account_fk foreign key(company_id,bank_account_id) references public.company_bank_accounts(company_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='financial_movements_company_bank_account_fk') then
    alter table public.financial_movements add constraint financial_movements_company_bank_account_fk foreign key(company_id,bank_account_id) references public.company_bank_accounts(company_id,id);
  end if;
end $$;

create or replace function public.assign_sale_receiving_account()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare account_row public.company_bank_accounts;
begin
  if new.bank_account_id is null then return new; end if;
  select * into account_row from public.company_bank_accounts
    where id=new.bank_account_id and company_id=new.company_id and active;
  if account_row.id is null then raise exception 'Conta recebedora não encontrada ou inativa'; end if;
  if auth.uid() is null or public.current_company_role(new.company_id) not in ('admin','gestor','financeiro','comercial','vendedor') then
    raise exception 'Sem permissão para vincular conta recebedora';
  end if;
  return new;
end;
$$;
revoke all on function public.assign_sale_receiving_account() from public, anon, authenticated, service_role;
create trigger sales_receiving_account_validate before update of bank_account_id on public.sales
  for each row execute function public.assign_sale_receiving_account();

create or replace function public.set_quote_sale_receiving_account(target_sale uuid, target_account uuid)
returns public.sales language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare sale_row public.sales; account_row public.company_bank_accounts;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into sale_row from public.sales where id=target_sale and public.is_company_member(company_id) for update;
  if sale_row.id is null or sale_row.origin_quote_id is null or sale_row.status <> 'draft' then raise exception 'Venda de orçamento não está aguardando faturamento'; end if;
  if public.current_company_role(sale_row.company_id) not in ('admin','gestor','financeiro','comercial','vendedor') then raise exception 'Sem permissão para selecionar conta recebedora'; end if;
  if target_account is not null then
    select * into account_row from public.company_bank_accounts where id=target_account and company_id=sale_row.company_id and active;
    if account_row.id is null then raise exception 'Conta recebedora não encontrada ou inativa'; end if;
  end if;
  update public.sales set bank_account_id=target_account where id=sale_row.id returning * into sale_row;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
    values(sale_row.company_id,auth.uid(),'sale.receiving_account_selected','Sale',sale_row.id,
      jsonb_build_object('sale_id',sale_row.id,'bank_account_id',target_account,'bank_account_label',account_row.label));
  return sale_row;
end;
$$;
revoke all on function public.set_quote_sale_receiving_account(uuid,uuid) from public, anon, service_role;
grant execute on function public.set_quote_sale_receiving_account(uuid,uuid) to authenticated;

create or replace function public.link_sale_financial_account()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare account_row public.company_bank_accounts;
begin
  if new.sale_id is null then return new; end if;
  select a.* into account_row from public.company_bank_accounts a
    join public.sales s on s.company_id=a.company_id and s.bank_account_id=a.id
    where s.id=new.sale_id and s.company_id=new.company_id and a.active;
  if account_row.id is not null then
    new.bank_account_id := account_row.id;
    new.account := account_row.label || ' · ' || account_row.institution_name;
  end if;
  return new;
end;
$$;
revoke all on function public.link_sale_financial_account() from public, anon, authenticated, service_role;
create trigger financial_entry_link_bank_account before insert on public.financial_entries
  for each row execute function public.link_sale_financial_account();

create or replace function public.record_financial_payment_to_account(
  target_entry uuid, payment_amount numeric, payment_method_value text default null,
  target_installment uuid default null, payment_idempotency_key text default null,
  occurred_at_value timestamptz default now(), target_bank_account uuid default null
) returns public.financial_entries language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare entry_row public.financial_entries; result public.financial_entries; account_row public.company_bank_accounts; movement_key text;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into entry_row from public.financial_entries where id=target_entry and public.is_company_member(company_id) for update;
  if entry_row.id is null then raise exception 'Lançamento não encontrado'; end if;
  if public.current_company_role(entry_row.company_id) not in ('admin','gestor','financeiro') then raise exception 'Sem permissão para confirmar recebimentos'; end if;
  if target_bank_account is not null then
    select * into account_row from public.company_bank_accounts where id=target_bank_account and company_id=entry_row.company_id and active;
    if account_row.id is null then raise exception 'Conta recebedora não encontrada ou inativa'; end if;
  end if;
  movement_key := coalesce(payment_idempotency_key,'finance-payment:'||entry_row.id::text||':'||coalesce(target_installment::text,'all')||':'||round(payment_amount*100)::text);
  result := public.record_financial_payment(target_entry,payment_amount,payment_method_value,target_installment,movement_key,occurred_at_value);
  if target_bank_account is not null then
    update public.financial_entries set bank_account_id=target_bank_account,account=account_row.label||' · '||account_row.institution_name where id=entry_row.id and company_id=entry_row.company_id returning * into result;
    update public.financial_movements set bank_account_id=target_bank_account,account=account_row.label||' · '||account_row.institution_name where company_id=entry_row.company_id and financial_entry_id=entry_row.id and idempotency_key=movement_key;
    insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data) values(entry_row.company_id,auth.uid(),'finance.payment_account_linked','FinancialEntry',entry_row.id,jsonb_build_object('bank_account_id',target_bank_account,'payment_idempotency_key',movement_key));
  end if;
  return result;
end;
$$;
revoke all on function public.record_financial_payment_to_account(uuid,numeric,text,uuid,text,timestamptz,uuid) from public, anon, service_role;
grant execute on function public.record_financial_payment_to_account(uuid,numeric,text,uuid,text,timestamptz,uuid) to authenticated;
