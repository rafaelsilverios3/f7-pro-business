-- F7 PRO BUSINESS — fluxo financeiro explícito, títulos, parcelas e caixa.
-- Aplicar manualmente após a revisão. Esta migration não executa db push.

alter table public.financial_entries
  add column if not exists nature text,
  add column if not exists category text,
  add column if not exists total_amount numeric(14,2),
  add column if not exists received_amount numeric(14,2) not null default 0,
  add column if not exists paid_amount numeric(14,2) not null default 0,
  add column if not exists source_type text,
  add column if not exists account text,
  add column if not exists payment_method text,
  add column if not exists cancelled_at timestamptz;

update public.financial_entries
set nature = case when type = 'payable' then 'expense' else 'revenue' end,
    total_amount = coalesce(total_amount, amount),
    received_amount = case when type = 'receivable' and status in ('paid', 'received') then coalesce(total_amount, amount) else coalesce(received_amount, 0) end,
    paid_amount = case when type = 'payable' and status = 'paid' then coalesce(total_amount, amount) else coalesce(paid_amount, 0) end
where nature is null or total_amount is null;

-- Correção segura de legado: somente categorias inequivocamente operacionais mudam de receber para pagar.
update public.financial_entries
set type = 'payable', nature = 'expense', paid_amount = greatest(coalesce(paid_amount, 0), coalesce(received_amount, 0)), received_amount = 0
where type = 'receivable'
  and lower(trim(coalesce(category, ''))) in ('aluguel', 'salário', 'salários', 'imposto', 'impostos', 'marketing', 'fornecedor', 'fornecedores', 'frete', 'energia', 'água', 'internet', 'taxas', 'manutenção');

alter table public.financial_entries alter column nature set default 'revenue';
alter table public.financial_entries alter column total_amount set default 0;
alter table public.financial_entries alter column nature set not null;
alter table public.financial_entries alter column total_amount set not null;
alter table public.financial_entries drop constraint if exists financial_entries_nature_check;
alter table public.financial_entries add constraint financial_entries_nature_check check (nature in ('revenue', 'expense'));
alter table public.financial_entries drop constraint if exists financial_entries_type_nature_check;
alter table public.financial_entries add constraint financial_entries_type_nature_check check ((type = 'receivable' and nature = 'revenue') or (type = 'payable' and nature = 'expense'));
alter table public.financial_entries drop constraint if exists financial_entries_settled_nonnegative;
alter table public.financial_entries add constraint financial_entries_settled_nonnegative check (total_amount > 0 and received_amount >= 0 and paid_amount >= 0 and received_amount <= total_amount and paid_amount <= total_amount);

create table if not exists public.financial_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_entry_id uuid not null references public.financial_entries(id) on delete cascade,
  installment_id uuid,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14,2) not null check (amount > 0),
  payment_method text,
  account text,
  occurred_at timestamptz not null default now(),
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique(company_id, idempotency_key)
);

create table if not exists public.financial_installments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_entry_id uuid not null references public.financial_entries(id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  amount numeric(14,2) not null check (amount > 0),
  received_amount numeric(14,2) not null default 0 check (received_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'partial', 'received', 'paid', 'overdue', 'cancelled')),
  created_at timestamptz not null default now(),
  unique(financial_entry_id, installment_number)
);

create unique index if not exists financial_entries_company_id_key on public.financial_entries(company_id, id);
create unique index if not exists financial_movements_company_id_key on public.financial_movements(company_id, id);
create unique index if not exists financial_installments_company_id_key on public.financial_installments(company_id, id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'financial_movements_company_entry_fk') then
    alter table public.financial_movements add constraint financial_movements_company_entry_fk foreign key (company_id, financial_entry_id) references public.financial_entries(company_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'financial_installments_company_entry_fk') then
    alter table public.financial_installments add constraint financial_installments_company_entry_fk foreign key (company_id, financial_entry_id) references public.financial_entries(company_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'financial_movements_company_installment_fk') then
    alter table public.financial_movements add constraint financial_movements_company_installment_fk foreign key (company_id, installment_id) references public.financial_installments(company_id, id);
  end if;
end $$;

create index if not exists idx_financial_entries_company_nature_status on public.financial_entries(company_id, nature, status, due_date);
create index if not exists idx_financial_movements_company_date on public.financial_movements(company_id, occurred_at);
create index if not exists idx_financial_movements_entry on public.financial_movements(financial_entry_id, occurred_at);
create index if not exists idx_financial_installments_company_due on public.financial_installments(company_id, due_date, status);

do $$ declare table_name text; begin
  foreach table_name in array array['financial_movements', 'financial_installments'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists finance_company_isolation on public.%I', table_name);
    execute format('create policy finance_company_isolation on public.%I for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id))', table_name);
    execute format('grant select, insert, update on public.%I to authenticated', table_name);
  end loop;
end $$;
grant select, insert, update on public.financial_entries to authenticated;

-- Compatibilidade com escritas antigas: a natureza é sempre derivada do tipo.
create or replace function public.prepare_financial_entry() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nature := case when new.type = 'payable' then 'expense' else 'revenue' end;
  new.total_amount := coalesce(new.total_amount, new.amount);
  new.amount := new.total_amount;
  if new.nature = 'revenue' then new.paid_amount := 0; end if;
  if new.nature = 'expense' then new.received_amount := 0; end if;
  return new;
end; $$;
drop trigger if exists financial_entries_prepare on public.financial_entries;
create trigger financial_entries_prepare before insert or update on public.financial_entries for each row execute function public.prepare_financial_entry();

-- Migra títulos históricos já baixados para o livro de caixa, sem duplicar.
insert into public.financial_movements(company_id, financial_entry_id, direction, amount, payment_method, account, occurred_at, idempotency_key)
select e.company_id, e.id, case when e.nature = 'revenue' then 'in' else 'out' end,
       case when e.nature = 'revenue' then e.received_amount else e.paid_amount end,
       e.payment_method, e.account, coalesce(e.paid_at, e.created_at), 'legacy:' || e.id::text
from public.financial_entries e
where (e.received_amount > 0 or e.paid_amount > 0)
  and not exists (select 1 from public.financial_movements m where m.company_id = e.company_id and m.idempotency_key = 'legacy:' || e.id::text);

insert into public.financial_installments(company_id, financial_entry_id, installment_number, amount, received_amount, paid_amount, due_date, status)
select e.company_id, e.id, 1, e.total_amount, e.received_amount, e.paid_amount, e.due_date,
       case when e.status = 'cancelled' then 'cancelled' when e.nature = 'revenue' and e.received_amount >= e.total_amount then 'received' when e.nature = 'expense' and e.paid_amount >= e.total_amount then 'paid' when e.received_amount > 0 or e.paid_amount > 0 then 'partial' else 'pending' end
from public.financial_entries e
where not exists (select 1 from public.financial_installments i where i.financial_entry_id = e.id);

create or replace function public.record_financial_payment(
  target_entry uuid,
  payment_amount numeric,
  payment_method_value text default null,
  target_installment uuid default null,
  payment_idempotency_key text default null,
  occurred_at_value timestamptz default now()
) returns public.financial_entries
language plpgsql security invoker set search_path = public as $$
declare entry_row public.financial_entries; installment_row public.financial_installments; movement_row public.financial_movements;
  value numeric(14,2) := round(payment_amount, 2); settled numeric(14,2); balance numeric(14,2); direction_value text;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  if payment_idempotency_key is not null then select * into movement_row from public.financial_movements where company_id = (select company_id from public.financial_entries where id = target_entry) and idempotency_key = payment_idempotency_key; if movement_row.id is not null then select * into entry_row from public.financial_entries where id = target_entry; return entry_row; end if; end if;
  select * into entry_row from public.financial_entries where id = target_entry and public.is_company_member(company_id) for update;
  if entry_row.id is null then raise exception 'Título financeiro não encontrado'; end if;
  if value is null or value <= 0 then raise exception 'Pagamento inválido'; end if;
  settled := case when entry_row.nature = 'revenue' then entry_row.received_amount else entry_row.paid_amount end;
  balance := round(entry_row.total_amount - settled, 2);
  if value > balance then raise exception 'Pagamento maior que o saldo pendente'; end if;
  direction_value := case when entry_row.nature = 'revenue' then 'in' else 'out' end;
  if target_installment is not null then
    select * into installment_row from public.financial_installments where id = target_installment and financial_entry_id = entry_row.id and company_id = entry_row.company_id for update;
    if installment_row.id is null then raise exception 'Parcela não encontrada'; end if;
    if value > round(installment_row.amount - case when entry_row.nature = 'revenue' then installment_row.received_amount else installment_row.paid_amount end, 2) then raise exception 'Pagamento maior que o saldo da parcela'; end if;
    if entry_row.nature = 'revenue' then update public.financial_installments set received_amount = received_amount + value, status = case when received_amount + value >= amount then 'received' else 'partial' end where id = installment_row.id; else update public.financial_installments set paid_amount = paid_amount + value, status = case when paid_amount + value >= amount then 'paid' else 'partial' end where id = installment_row.id; end if;
  end if;
  insert into public.financial_movements(company_id, financial_entry_id, installment_id, direction, amount, payment_method, account, occurred_at, idempotency_key) values(entry_row.company_id, entry_row.id, target_installment, direction_value, value, payment_method_value, entry_row.account, occurred_at_value, payment_idempotency_key);
  if entry_row.nature = 'revenue' then update public.financial_entries set received_amount = received_amount + value, status = case when received_amount + value >= total_amount then 'received' else 'partial' end, paid_date = case when received_amount + value >= total_amount then occurred_at_value::date else paid_date end, paid_at = occurred_at_value where id = entry_row.id returning * into entry_row; else update public.financial_entries set paid_amount = paid_amount + value, status = case when paid_amount + value >= total_amount then 'paid' else 'partial' end, paid_date = case when paid_amount + value >= total_amount then occurred_at_value::date else paid_date end, paid_at = occurred_at_value where id = entry_row.id returning * into entry_row; end if;
  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, new_data) values(entry_row.company_id, auth.uid(), 'finance.payment_recorded', 'FinancialEntry', entry_row.id, jsonb_build_object('amount', value, 'direction', direction_value, 'payment_method', payment_method_value));
  return entry_row;
end; $$;

create or replace function public.settle_financial_entry(entry_id uuid) returns public.financial_entries
language plpgsql security invoker set search_path = public as $$
declare entry_row public.financial_entries; balance numeric;
begin
  select * into entry_row from public.financial_entries where id = entry_id and public.is_company_member(company_id);
  if entry_row.id is null or entry_row.status = 'cancelled' then raise exception 'Lançamento não encontrado ou cancelado'; end if;
  balance := round(entry_row.total_amount - case when entry_row.nature = 'revenue' then entry_row.received_amount else entry_row.paid_amount end, 2);
  if balance <= 0 then return entry_row; end if;
  return public.record_financial_payment(entry_id, balance, coalesce(entry_row.payment_method, 'manual'), null, 'settle:' || entry_id::text, now());
end; $$;

-- O título da venda só recebe caixa quando há pagamentos informados pelo operador.
create or replace function public.finalize_sale_financial(sale_payload jsonb) returns public.sales
language plpgsql security invoker set search_path = public as $$
declare sale_row public.sales; entry_row public.financial_entries; payment jsonb; payment_index integer := 0; installment_count integer := greatest(1, coalesce((sale_payload->>'installments')::integer, 1)); installment_amount numeric(14,2); installment_number integer; due_date date := coalesce(nullif(sale_payload->>'due_date', '')::date, current_date);
begin
  sale_row := public.finalize_sale(sale_payload);
  select * into entry_row from public.financial_entries where sale_id = sale_row.id and type = 'receivable' order by created_at desc limit 1 for update;
  if entry_row.id is null then raise exception 'Conta a receber da venda não foi criada'; end if;
  delete from public.financial_movements where financial_entry_id = entry_row.id;
  delete from public.financial_installments where financial_entry_id = entry_row.id;
  update public.financial_entries set nature = 'revenue', total_amount = sale_row.total, amount = sale_row.total, received_amount = 0, paid_amount = 0, status = 'pending', paid_date = null, paid_at = null where id = entry_row.id returning * into entry_row;
  installment_amount := round(sale_row.total / installment_count, 2);
  for installment_number in 1..installment_count loop
    insert into public.financial_installments(company_id, financial_entry_id, installment_number, amount, due_date) values(entry_row.company_id, entry_row.id, installment_number, case when installment_number = installment_count then sale_row.total - installment_amount * (installment_count - 1) else installment_amount end, (due_date + ((installment_number - 1) * interval '1 month'))::date);
  end loop;
  for payment in select * from jsonb_array_elements(case when jsonb_typeof(sale_payload->'payments') = 'array' then sale_payload->'payments' else '[]'::jsonb end) loop
    payment_index := payment_index + 1;
    perform public.record_financial_payment(entry_row.id, (payment->>'amount')::numeric, nullif(payment->>'payment_method', ''), null, 'sale:' || sale_row.id::text || ':' || payment_index::text, now());
  end loop;
  return sale_row;
end; $$;

revoke all on function public.record_financial_payment(uuid,numeric,text,uuid,text,timestamptz) from public, anon;
revoke all on function public.finalize_sale_financial(jsonb) from public, anon;
revoke execute on function public.finalize_sale(jsonb) from authenticated;
grant execute on function public.record_financial_payment(uuid,numeric,text,uuid,text,timestamptz) to authenticated;
grant execute on function public.finalize_sale_financial(jsonb) to authenticated;
