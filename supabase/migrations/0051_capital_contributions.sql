-- Capital, investimento e reforço de caixa: entradas não operacionais.
-- Aplicação manual após revisão; não altera migrations anteriores.
-- Rollback conceitual: desativar o fluxo de capital e remover apenas seus
-- lançamentos após exportação, preservando títulos e movimentos existentes.

alter table public.financial_entries
  add column if not exists entry_class text not null default 'operating',
  add column if not exists capital_type text,
  add column if not exists source_detail text,
  add column if not exists notes text,
  add column if not exists is_operating boolean not null default true;

alter table public.financial_entries alter column due_date drop not null;
alter table public.financial_entries drop constraint if exists financial_entries_nature_check;
alter table public.financial_entries add constraint financial_entries_nature_check check (nature in ('revenue','expense','capital'));
alter table public.financial_entries drop constraint if exists financial_entries_type_nature_check;
alter table public.financial_entries add constraint financial_entries_type_nature_check check ((type = 'receivable' and nature = 'revenue') or (type = 'payable' and nature = 'expense') or (type = 'capital' and nature = 'capital'));
alter table public.financial_entries drop constraint if exists financial_entries_entry_class_check;
alter table public.financial_entries add constraint financial_entries_entry_class_check check (entry_class in ('operating','capital','financing'));
alter table public.financial_entries drop constraint if exists financial_entries_capital_type_check;
alter table public.financial_entries add constraint financial_entries_capital_type_check check (capital_type is null or capital_type in ('working_capital','partner_contribution','owner_investment','partner_loan','cash_reserve','other_contribution'));

create index if not exists idx_financial_entries_company_class on public.financial_entries(company_id,entry_class,nature,created_at);

create or replace function public.prepare_financial_entry() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.type = 'capital' or new.nature = 'capital' or new.entry_class = 'capital' then
    new.type := 'capital'; new.nature := 'capital'; new.entry_class := 'capital'; new.is_operating := false; new.due_date := null;
    new.total_amount := coalesce(new.total_amount, new.amount); new.amount := new.total_amount;
    new.received_amount := new.total_amount; new.paid_amount := 0; new.status := 'received';
  else
    new.nature := case when new.type = 'payable' then 'expense' else 'revenue' end; new.entry_class := 'operating'; new.is_operating := true;
    new.total_amount := coalesce(new.total_amount, new.amount); new.amount := new.total_amount;
    if new.nature = 'revenue' then new.paid_amount := 0; end if;
    if new.nature = 'expense' then new.received_amount := 0; end if;
  end if;
  return new;
end; $$;

create or replace function public.record_capital_contribution(
  target_company uuid,
  amount_input numeric,
  capital_type_input text default 'working_capital',
  occurred_at_input timestamptz default now(),
  account_input text default 'Caixa',
  source_detail_input text default null,
  description_input text default null,
  notes_input text default null,
  idempotency_key_input text default null
) returns public.financial_entries language plpgsql security invoker set search_path = public as $$
declare company uuid; entry_row public.financial_entries; movement_id uuid; value numeric(14,2) := round(amount_input,2);
begin
  if not public.is_company_member(target_company) then raise exception 'Empresa não encontrada'; end if;
  select company_id into company from public.company_users where company_id=target_company and user_id=auth.uid() and active;
  if company is null then raise exception 'Empresa não encontrada'; end if;
  if value is null or value <= 0 then raise exception 'Valor do aporte inválido'; end if;
  if nullif(trim(idempotency_key_input),'') is not null then select m.financial_entry_id into movement_id from public.financial_movements m where m.company_id=company and m.idempotency_key=idempotency_key_input; if movement_id is not null then select * into entry_row from public.financial_entries where id=movement_id; return entry_row; end if; end if;
  insert into public.financial_entries(company_id,type,nature,entry_class,capital_type,is_operating,source_type,source_detail,notes,description,category,total_amount,amount,received_amount,paid_amount,status,due_date,paid_date,paid_at,created_by)
    values(company,'capital','capital','capital',capital_type_input,false,'capital',source_detail_input,notes_input,coalesce(description_input,'Entrada de capital'),capital_type_input,value,value,value,0,'received',null,occurred_at_input::date,occurred_at_input,auth.uid()) returning * into entry_row;
  insert into public.financial_movements(company_id,financial_entry_id,direction,amount,payment_method,account,occurred_at,idempotency_key)
    values(company,entry_row.id,'in',value,'capital',account_input,occurred_at_input,nullif(trim(idempotency_key_input),'') ) returning id into movement_id;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data) values(company,auth.uid(),'finance.capital_recorded','FinancialEntry',entry_row.id,jsonb_build_object('amount',value,'capital_type',capital_type_input,'source','capital'));
  return entry_row;
end; $$;

revoke all on function public.record_capital_contribution(uuid,numeric,text,timestamptz,text,text,text,text,text) from public, anon;
grant execute on function public.record_capital_contribution(uuid,numeric,text,timestamptz,text,text,text,text,text) to authenticated;
