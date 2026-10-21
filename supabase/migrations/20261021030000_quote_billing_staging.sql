-- Route approved quotes into a pending sale, preserving a separate explicit
-- billing confirmation before inventory, revenue, and receivable mutations.
-- Rollback: stop new quote billing first; reconcile pending sales manually,
-- then restore the previous RPCs/triggers before dropping added columns.

alter table public.quotes
  add column if not exists quote_number text,
  add column if not exists cancellation_reason text;

create table if not exists public.quote_number_sequences (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0)
);
alter table public.quote_number_sequences enable row level security;
revoke all on public.quote_number_sequences from public, anon, authenticated;

with numbered as (
  select id, company_id, row_number() over (partition by company_id order by created_at, id) as n
  from public.quotes where quote_number is null
)
update public.quotes q
set quote_number = 'ORC-' || to_char(q.created_at, 'YYYY') || '-' || lpad(numbered.n::text, 6, '0')
from numbered where q.id = numbered.id;

insert into public.quote_number_sequences(company_id, last_number)
select company_id, greatest(count(*), coalesce(max(case when quote_number ~ '[0-9]+$' then substring(quote_number from '([0-9]+)$')::bigint else 0 end), 0)) from public.quotes group by company_id
on conflict (company_id) do update set last_number = greatest(public.quote_number_sequences.last_number, excluded.last_number);

alter table public.quotes alter column quote_number set not null;
create unique index if not exists quotes_company_number_key on public.quotes(company_id, quote_number);
create unique index if not exists quotes_company_id_key on public.quotes(company_id, id);

alter table public.sales
  add column if not exists origin_quote_id uuid,
  add column if not exists origin_quote_number text,
  add column if not exists seller text,
  add column if not exists payment_method text,
  add column if not exists installments integer not null default 1,
  add column if not exists notes text,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid,
  add column if not exists cancellation_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sales_company_origin_quote_fk') then
    alter table public.sales add constraint sales_company_origin_quote_fk
      foreign key (company_id, origin_quote_id) references public.quotes(company_id, id);
  end if;
end $$;
create unique index if not exists sales_company_origin_quote_key on public.sales(company_id, origin_quote_id) where origin_quote_id is not null;
create index if not exists sales_company_status_date_idx on public.sales(company_id, status, sale_date desc);

create or replace function public.guard_quote_origin_sale()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.origin_quote_id is not null and current_setting('f7.quote_sale_create', true) is distinct from new.origin_quote_id::text then
    raise exception 'Venda originada de orçamento exige RPC validada';
  end if;
  if tg_op = 'UPDATE' and old.origin_quote_id is not null then
    if new.origin_quote_id is distinct from old.origin_quote_id
      or new.origin_quote_number is distinct from old.origin_quote_number
      or new.customer_id is distinct from old.customer_id
      or new.items is distinct from old.items
      or new.subtotal is distinct from old.subtotal
      or new.discount is distinct from old.discount
      or new.addition is distinct from old.addition
      or new.total is distinct from old.total
      or new.cost_total is distinct from old.cost_total then
      raise exception 'Snapshot da venda originada de orçamento é imutável';
    end if;
    if new.status is distinct from old.status and current_setting('f7.quote_sale_transition', true) is distinct from old.id::text then
      raise exception 'Mudança de estado da venda de orçamento exige RPC validada';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists sales_guard_quote_origin on public.sales;
create trigger sales_guard_quote_origin before insert or update on public.sales
for each row execute function public.guard_quote_origin_sale();

create or replace function public.validate_quote_commercial()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare item jsonb; subtotal_value numeric(14,2) := 0; allowed_transition boolean := false; discount_value numeric(14,2); addition_value numeric(14,2); next_number bigint;
begin
  if auth.uid() is null or not public.is_company_member(new.company_id) then raise exception 'Usuário não pertence à empresa'; end if;
  if new.customer_id is not null and not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id) then raise exception 'Cliente não pertence à empresa'; end if;
  if new.seller_user_id is not null and not exists (select 1 from public.company_users m where m.company_id = new.company_id and m.user_id = new.seller_user_id and m.active) then raise exception 'Vendedor não é membro ativo da empresa'; end if;
  if tg_op = 'INSERT' and new.quote_number is null then
    insert into public.quote_number_sequences(company_id, last_number) values(new.company_id, 1)
    on conflict(company_id) do update set last_number = public.quote_number_sequences.last_number + 1
    returning last_number into next_number;
    new.quote_number := 'ORC-' || to_char(coalesce(new.created_at, now()), 'YYYY') || '-' || lpad(next_number::text, 6, '0');
  end if;
  if tg_op = 'UPDATE' and old.quote_number is distinct from new.quote_number then raise exception 'Número do orçamento é imutável'; end if;
  if new.opportunity_id is not null and not exists (select 1 from public.opportunities o where o.id = new.opportunity_id and o.company_id = new.company_id) then raise exception 'Oportunidade não pertence à empresa'; end if;
  new.items := public.quote_items_normalize(new.items, new.company_id);
  for item in select value from jsonb_array_elements(new.items) loop subtotal_value := subtotal_value + (item->>'subtotal')::numeric; end loop;
  subtotal_value := round(subtotal_value, 2); discount_value := greatest(0, coalesce(new.discount, 0)); addition_value := greatest(0, coalesce(new.addition, 0));
  new.subtotal := subtotal_value; new.discount := discount_value; new.addition := addition_value; new.total := greatest(0, round(subtotal_value - discount_value + addition_value, 2)); new.updated_at := now();
  if new.status not in ('draft','sent','viewed','negotiating','approved','billing_pending','refused','expired','converted','cancelled') then raise exception 'Status de orçamento inválido'; end if;
  if tg_op = 'UPDATE' and new.status='cancelled' and old.status is distinct from new.status and length(trim(coalesce(new.cancellation_reason,''))) < 3 then raise exception 'Informe o motivo do cancelamento do orçamento'; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status in ('cancelled','refused','expired') or (old.status = 'converted' and not (new.status = 'cancelled' and exists (select 1 from public.sales s where s.id = old.sale_id and s.company_id = old.company_id and s.status = 'cancelled'))) then raise exception 'Orçamento em estado terminal'; end if;
    allowed_transition := case old.status
      when 'draft' then new.status in ('sent','viewed','negotiating','approved','refused','cancelled')
      when 'sent' then new.status in ('viewed','negotiating','approved','refused','expired','cancelled')
      when 'viewed' then new.status in ('negotiating','approved','refused','expired','cancelled')
      when 'negotiating' then new.status in ('approved','refused','expired','cancelled')
      when 'approved' then new.status in ('billing_pending','cancelled')
      when 'billing_pending' then new.status in ('approved','converted','cancelled')
      when 'converted' then new.status='cancelled' and exists (select 1 from public.sales s where s.id=old.sale_id and s.company_id=old.company_id and s.status='cancelled')
      else false end;
    if not allowed_transition then raise exception 'Transição de orçamento inválida'; end if;
    if new.status = 'approved' then new.approved_at := coalesce(new.approved_at, now()); end if;
    if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
    if new.status = 'refused' then new.rejected_at := coalesce(new.rejected_at, now()); end if;
    if new.status = 'converted' and (new.sale_id is null or not exists (select 1 from public.sales s where s.id = new.sale_id and s.company_id = new.company_id and s.status = 'completed' and s.origin_quote_id = new.id)) then raise exception 'Orçamento só converte após faturar a venda vinculada'; end if;
    if new.status = 'billing_pending' and (new.sale_id is null or not exists (select 1 from public.sales s where s.id = new.sale_id and s.company_id = new.company_id and s.status = 'draft' and s.origin_quote_id = new.id)) then raise exception 'Venda pendente vinculada não encontrada'; end if;
  elsif tg_op = 'UPDATE' and old.status in ('approved','billing_pending','converted') and (new.items is distinct from old.items or new.customer_id is distinct from old.customer_id or new.subtotal is distinct from old.subtotal or new.discount is distinct from old.discount or new.addition is distinct from old.addition or new.total is distinct from old.total or new.valid_until is distinct from old.valid_until) then
    raise exception 'Snapshot comercial aprovado não pode ser alterado';
  end if;
  if tg_op = 'UPDATE' and new.sale_id is distinct from old.sale_id then
    if not ((old.status='approved' and new.status='billing_pending' and exists (select 1 from public.sales s where s.id=new.sale_id and s.company_id=new.company_id and s.status='draft' and s.origin_quote_id=new.id))
      or (old.status='billing_pending' and new.status='approved' and new.sale_id is null and exists (select 1 from public.sales s where s.id=old.sale_id and s.company_id=old.company_id and s.status='cancelled'))) then
      raise exception 'Vínculo da venda só pode mudar por uma transição comercial validada';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data)
    values(new.company_id,auth.uid(),'quote.status_changed','Quote',new.id,jsonb_build_object('status',old.status,'sale_id',old.sale_id),jsonb_build_object('status',new.status,'sale_id',new.sale_id,'quote_number',new.quote_number,'reason',new.cancellation_reason));
  end if;
  return new;
end; $$;

create or replace function public.send_quote_to_sales(target_quote uuid)
returns public.sales language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare q public.quotes; sale public.sales; snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into q from public.quotes where id = target_quote and public.is_company_member(company_id) for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if public.current_company_role(q.company_id) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para enviar à etapa de faturamento'; end if;
  if q.sale_id is not null then select * into sale from public.sales where id = q.sale_id and company_id = q.company_id; if sale.id is not null then return sale; end if; end if;
  if q.status <> 'approved' then raise exception 'Aprove o orçamento antes de enviar para vendas'; end if;
  if q.valid_until is not null and q.valid_until < current_date then raise exception 'Orçamento expirado'; end if;
  if q.customer_id is null then raise exception 'Selecione um cliente antes de enviar para vendas'; end if;
  if q.items is null or jsonb_typeof(q.items) <> 'array' or jsonb_array_length(q.items) = 0 then raise exception 'Orçamento sem itens'; end if;
  if exists (select 1 from jsonb_array_elements(q.items) i where nullif(coalesce(i->>'unit_price',i->>'price'),'') is null or nullif(coalesce(i->>'unit_cost',i->>'cost'),'') is null) then raise exception 'Snapshot do orçamento exige revisão'; end if;
  select jsonb_agg(jsonb_build_object('product_id', i->>'product_id', 'variant_id', i->>'variant_id', 'item_type', coalesce(i->>'item_type','product'), 'name', i->>'name', 'qty', coalesce(i->>'qty',i->>'quantity'), 'quantity', coalesce(i->>'qty',i->>'quantity'), 'price', coalesce(i->>'unit_price',i->>'price'), 'cost', coalesce(i->>'unit_cost',i->>'cost'), 'total', coalesce(i->>'total', ((coalesce(i->>'unit_price',i->>'price'))::numeric * (coalesce(i->>'qty',i->>'quantity'))::numeric)::text))) into snapshot from jsonb_array_elements(q.items) i;
  perform set_config('f7.quote_sale_create',q.id::text,true);
  insert into public.sales(company_id,customer_id,status,items,subtotal,discount,addition,total,cost_total,profit,idempotency_key,origin_quote_id,origin_quote_number,seller,notes)
  values(q.company_id,q.customer_id,'draft',snapshot,q.subtotal,q.discount,q.addition,q.total,coalesce((select sum((i->>'qty')::numeric*(i->>'cost')::numeric) from jsonb_array_elements(snapshot) i),0),q.total-coalesce((select sum((i->>'qty')::numeric*(i->>'cost')::numeric) from jsonb_array_elements(snapshot) i),0),'quote:'||q.id::text,q.id,q.quote_number,coalesce((select p.name from public.profiles p where p.id=q.seller_user_id),''),'Aguardando faturamento · origem '||q.quote_number)
  on conflict (company_id,idempotency_key) do update set idempotency_key = excluded.idempotency_key returning * into sale;
  update public.quotes set status='billing_pending',sale_id=sale.id where id=q.id and company_id=q.company_id returning * into q;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(q.company_id,auth.uid(),'quote.sent_to_sales','Quote',q.id,jsonb_build_object('status','approved'),jsonb_build_object('status',q.status,'sale_id',sale.id,'quote_number',q.quote_number));
  return sale;
end; $$;

create or replace function public.return_quote_sale_to_quote(target_sale uuid)
returns public.sales language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare s public.sales; q public.quotes;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into s from public.sales where id=target_sale and public.is_company_member(company_id) for update;
  if s.id is null or s.origin_quote_id is null then raise exception 'Venda de orçamento não encontrada'; end if;
  if public.current_company_role(s.company_id) not in ('admin','gestor','comercial') then raise exception 'Sem permissão para retornar ao orçamento'; end if;
  if s.status <> 'draft' then raise exception 'Retorno permitido somente antes do faturamento'; end if;
  select * into q from public.quotes where id=s.origin_quote_id and company_id=s.company_id for update;
  if q.status <> 'billing_pending' or q.sale_id <> s.id then raise exception 'Vínculo do orçamento mudou'; end if;
  perform set_config('f7.quote_sale_transition',s.id::text,true);
  update public.sales set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid() where id=s.id returning * into s;
  update public.quotes set status='approved',sale_id=null where id=q.id returning * into q;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(s.company_id,auth.uid(),'sale.returned_to_quote','Sale',s.id,to_jsonb(s),jsonb_build_object('quote_id',q.id,'quote_number',q.quote_number,'status',q.status));
  return s;
end; $$;

create or replace function public.finalize_quote_sale(target_sale uuid, billing_payload jsonb)
returns public.sales language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  pending public.sales; q public.quotes; result public.sales; item jsonb; product_row public.products; variant_row public.product_variants;
  normalized_items jsonb := '[]'::jsonb; qty numeric; unit_price numeric; unit_cost numeric; line_total numeric; variant uuid; item_type text;
  subtotal_value numeric(14,2) := 0; calculated_cost_total numeric(14,2) := 0; commission_total numeric(14,2) := 0; commission_rate numeric(8,3) := 0;
  installment_count integer; installment_amount numeric(14,2); installment_number integer; due_date date; entry_row public.financial_entries;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into pending from public.sales where id=target_sale and public.is_company_member(company_id) for update;
  if pending.id is null or pending.origin_quote_id is null then raise exception 'Venda pendente de orçamento não encontrada'; end if;
  if public.current_company_role(pending.company_id) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para faturar'; end if;
  if pending.status='completed' then return pending; end if;
  if pending.status <> 'draft' then raise exception 'Venda não está aguardando faturamento'; end if;
  select * into q from public.quotes where id=pending.origin_quote_id and company_id=pending.company_id for update;
  if q.status <> 'billing_pending' or q.sale_id <> pending.id then raise exception 'Orçamento não está aguardando faturamento'; end if;
  if pending.items is distinct from (select jsonb_agg(jsonb_build_object('product_id', i->>'product_id', 'variant_id', i->>'variant_id', 'item_type', coalesce(i->>'item_type','product'), 'name', i->>'name', 'qty', i->>'qty', 'quantity', i->>'quantity', 'price', i->>'price', 'cost', i->>'cost', 'total', i->>'total')) from jsonb_array_elements(q.items) i)
    or pending.subtotal <> q.subtotal or pending.discount <> q.discount or pending.addition <> q.addition or pending.total <> q.total then raise exception 'Snapshot comercial divergente do orçamento'; end if;
  installment_count := greatest(1, least(24, coalesce((billing_payload->>'installments')::integer,1)));
  due_date := coalesce(nullif(billing_payload->>'due_date','')::date,current_date);
  if nullif(trim(billing_payload->>'payment_method'),'') is null then raise exception 'Selecione a forma de pagamento'; end if;
  if due_date < current_date then raise exception 'O primeiro vencimento não pode estar no passado'; end if;
  if pending.total <= 0 then raise exception 'Não é possível faturar um orçamento com total igual a zero'; end if;

  -- Lock current catalog rows for stock checks, while honoring the approved quote price/cost snapshot.
  for item in select value from jsonb_array_elements(pending.items) loop
    qty := nullif(coalesce(item->>'qty',item->>'quantity'),'')::numeric;
    unit_price := nullif(coalesce(item->>'price',item->>'unit_price'),'')::numeric;
    unit_cost := nullif(coalesce(item->>'cost',item->>'unit_cost'),'')::numeric;
    item_type := coalesce(item->>'item_type','product'); variant := nullif(item->>'variant_id','')::uuid;
    if qty is null or qty <= 0 or unit_price is null or unit_price < 0 or unit_cost is null or unit_cost < 0 then raise exception 'Snapshot de item inválido'; end if;
    select * into product_row from public.products where id=(item->>'product_id')::uuid and company_id=pending.company_id and active for update;
    if product_row.id is null or product_row.item_type <> item_type then raise exception 'Produto ou serviço do orçamento não está disponível'; end if;
    if item_type='service' then
      if variant is not null then raise exception 'Serviço não possui variação de estoque'; end if;
    elsif item_type='product' then
      if variant is null then
        if product_row.stock < qty then raise exception 'Estoque insuficiente para faturar o orçamento'; end if;
      else
        select * into variant_row from public.product_variants where id=variant and product_id=product_row.id and company_id=pending.company_id and active for update;
        if variant_row.id is null or variant_row.stock < qty then raise exception 'Variação sem estoque suficiente para faturar o orçamento'; end if;
      end if;
    else raise exception 'Tipo de item inválido no orçamento'; end if;
    line_total := round(qty*unit_price,2); subtotal_value := subtotal_value + line_total; calculated_cost_total := calculated_cost_total + qty*unit_cost;
    commission_rate := commission_rate + greatest(0,coalesce(product_row.commission_rate,0));
    commission_total := commission_total + round(line_total*greatest(0,coalesce(product_row.commission_rate,0))/100,2);
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object('product_id',product_row.id,'variant_id',variant,'item_type',item_type,'name',coalesce(nullif(item->>'name',''),product_row.name),'qty',qty,'quantity',qty,'price',round(unit_price,2),'cost',round(unit_cost,2),'total',line_total,'commission_rate',greatest(0,coalesce(product_row.commission_rate,0))));
  end loop;
  subtotal_value := round(subtotal_value,2); calculated_cost_total := round(calculated_cost_total,2);
  if subtotal_value <> pending.subtotal or calculated_cost_total <> pending.cost_total or greatest(0,round(subtotal_value-pending.discount+pending.addition,2)) <> pending.total then raise exception 'Totais ou custos do orçamento aprovado não conferem'; end if;

  -- The operation is atomic: no stock, receivable, customer, or completion write survives a failure.
  for item in select value from jsonb_array_elements(normalized_items) loop
    qty := (item->>'qty')::numeric; variant := nullif(item->>'variant_id','')::uuid;
    if item->>'item_type'='product' then
      if variant is null then update public.products set stock=stock-qty,updated_at=now() where id=(item->>'product_id')::uuid and company_id=pending.company_id;
      else update public.product_variants set stock=stock-qty,updated_at=now() where id=variant and company_id=pending.company_id; end if;
      insert into public.stock_movements(company_id,product_id,variant_id,sale_id,type,quantity,reason) values(pending.company_id,(item->>'product_id')::uuid,variant,pending.id,'out',qty,'Faturamento de orçamento '||q.quote_number);
    end if;
    insert into public.sale_items(company_id,sale_id,product_id,variant_id,quantity,price,cost) values(pending.company_id,pending.id,(item->>'product_id')::uuid,variant,qty,(item->>'price')::numeric,(item->>'cost')::numeric);
  end loop;
  insert into public.financial_entries(company_id,sale_id,type,status,description,amount,total_amount,due_date,payment_method)
  values(pending.company_id,pending.id,'receivable','pending','Venda '||pending.id::text||' · Orçamento '||q.quote_number,pending.total,pending.total,due_date,billing_payload->>'payment_method') returning * into entry_row;
  installment_amount := round(pending.total/installment_count,2);
  for installment_number in 1..installment_count loop
    insert into public.financial_installments(company_id,financial_entry_id,installment_number,amount,due_date)
    values(entry_row.company_id,entry_row.id,installment_number,case when installment_number=installment_count then pending.total-installment_amount*(installment_count-1) else installment_amount end,(due_date+((installment_number-1)*interval '1 month'))::date);
  end loop;
  perform set_config('f7.quote_sale_transition',pending.id::text,true);
  update public.sales set status='completed',profit=pending.total-pending.cost_total,payment_method=billing_payload->>'payment_method',installments=installment_count,completed_at=now(),completed_by=auth.uid(),sale_date=current_date where id=pending.id and company_id=pending.company_id returning * into result;
  if pending.customer_id is not null then update public.customers set total_purchased=total_purchased+pending.total,sale_count=sale_count+1,avg_ticket=round((total_purchased+pending.total)/(sale_count+1),2),last_purchase_date=current_date,updated_at=now() where id=pending.customer_id and company_id=pending.company_id; end if;
  if nullif(trim(pending.seller),'') is not null and commission_total>0 then insert into public.commissions(company_id,sale_id,seller,rate,amount,status) values(pending.company_id,pending.id,pending.seller,commission_rate/jsonb_array_length(normalized_items),commission_total,'pending'); end if;
  update public.quotes set status='converted',converted_at=coalesce(converted_at,now()) where id=q.id and company_id=q.company_id;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(pending.company_id,auth.uid(),'quote.sale_finalized','Sale',pending.id,to_jsonb(pending),jsonb_build_object('sale_id',pending.id,'quote_id',q.id,'quote_number',q.quote_number,'payment_method',billing_payload->>'payment_method','installments',installment_count,'total',result.total));
  return result;
end; $$;

create or replace function public.cancel_sale(target_sale uuid)
returns public.sales language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare result public.sales; previous_sale public.sales; item jsonb; variant uuid;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into result from public.sales where id=target_sale and public.is_company_member(company_id) for update;
  if result.id is null then raise exception 'Venda não encontrada'; end if;
  if public.current_company_role(result.company_id) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para cancelar venda'; end if;
  if result.status='cancelled' then return result; end if;
  previous_sale:=result;
  if result.status='draft' then
    if result.origin_quote_id is not null then perform set_config('f7.quote_sale_transition',result.id::text,true); end if;
    update public.sales set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid() where id=result.id returning * into result;
    if result.origin_quote_id is not null then update public.quotes set status='cancelled',cancelled_at=now(),cancellation_reason='Venda pendente cancelada em Vendas' where id=result.origin_quote_id and company_id=result.company_id and status='billing_pending'; end if;
    insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(result.company_id,auth.uid(),'sale.draft_cancelled','Sale',result.id,to_jsonb(previous_sale),to_jsonb(result)); return result;
  end if;
  if exists (select 1 from public.financial_entries e join public.financial_movements m on m.financial_entry_id=e.id and m.company_id=e.company_id where e.company_id=result.company_id and e.sale_id=result.id) then
    raise exception 'Venda com recebimento registrado exige estorno financeiro antes do cancelamento';
  end if;
  for item in select * from jsonb_array_elements(result.items) loop
    if coalesce(item->>'item_type','product')='product' then
      variant:=nullif(item->>'variant_id','')::uuid;
      if variant is null then update public.products set stock=stock+(item->>'qty')::numeric where id=(item->>'product_id')::uuid and company_id=result.company_id;
      else update public.product_variants set stock=stock+(item->>'qty')::numeric,updated_at=now() where id=variant and company_id=result.company_id; end if;
      insert into public.stock_movements(company_id,product_id,variant_id,sale_id,type,quantity,reason) values(result.company_id,(item->>'product_id')::uuid,variant,result.id,'in',(item->>'qty')::numeric,'Estorno de venda');
    end if;
  end loop;
  update public.financial_entries set status='cancelled',cancelled_at=now() where sale_id=result.id and status<>'cancelled';
  update public.commissions set status='reversed' where sale_id=result.id and status<>'reversed';
  perform set_config('f7.quote_sale_transition',result.id::text,true);
  update public.sales set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid() where id=result.id returning * into result;
  if result.customer_id is not null then
    update public.customers set total_purchased=greatest(0,total_purchased-result.total), sale_count=greatest(0,sale_count-1), avg_ticket=case when sale_count > 1 then round(greatest(0,total_purchased-result.total)/greatest(1,sale_count-1),2) else 0 end,
      last_purchase_date=(select max(s.sale_date) from public.sales s where s.company_id=result.company_id and s.customer_id=result.customer_id and s.id<>result.id and s.status='completed'), updated_at=now()
    where id=result.customer_id and company_id=result.company_id;
  end if;
  if result.origin_quote_id is not null then update public.quotes set status='cancelled',cancelled_at=now(),cancellation_reason='Venda cancelada em Vendas' where id=result.origin_quote_id and company_id=result.company_id and status='converted'; end if;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(result.company_id,auth.uid(),'sale.cancelled','Sale',result.id,to_jsonb(previous_sale),to_jsonb(result)); return result;
end; $$;

create or replace function public.cancel_quote(target_quote uuid, reason text)
returns public.quotes language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare q public.quotes; s public.sales;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into q from public.quotes where id=target_quote and public.is_company_member(company_id) for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if public.current_company_role(q.company_id) not in ('admin','gestor','comercial','vendedor') then raise exception 'Sem permissão para cancelar orçamento'; end if;
  if length(trim(coalesce(reason,''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
  if q.status in ('converted','cancelled','refused','expired') then raise exception 'Orçamento não pode ser cancelado neste estado'; end if;
  if q.sale_id is not null then select * into s from public.sales where id=q.sale_id and company_id=q.company_id for update; if s.status='completed' then raise exception 'Venda faturada exige cancelamento pela tela de Vendas'; end if; if s.origin_quote_id is not null then perform set_config('f7.quote_sale_transition',s.id::text,true); end if; update public.sales set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid() where id=q.sale_id and company_id=q.company_id and status='draft'; end if;
  update public.quotes set status='cancelled',cancelled_at=now(),cancellation_reason=left(trim(reason),500) where id=q.id returning * into q;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data) values(q.company_id,auth.uid(),'quote.cancelled','Quote',q.id,jsonb_build_object('status',q.status),jsonb_build_object('status','cancelled','reason',q.cancellation_reason)); return q;
end; $$;

create or replace function public.cancel_sale_with_reason(target_sale uuid, reason text)
returns public.sales language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare result public.sales; old_sale public.sales; clean_reason text := left(trim(coalesce(reason,'')),500);
begin
  if length(clean_reason) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
  select * into old_sale from public.sales where id=target_sale and public.is_company_member(company_id) for update;
  if old_sale.id is null then raise exception 'Venda não encontrada'; end if;
  result := public.cancel_sale(target_sale);
  update public.sales set cancellation_reason=clean_reason where id=target_sale and company_id=old_sale.company_id returning * into result;
  if result.origin_quote_id is not null then
    update public.quotes set cancellation_reason=clean_reason where id=result.origin_quote_id and company_id=result.company_id;
  end if;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data)
  values(result.company_id,auth.uid(),'sale.cancellation_reason_recorded','Sale',result.id,to_jsonb(old_sale),jsonb_build_object('reason',clean_reason,'status',result.status));
  return result;
end; $$;

revoke all on function public.send_quote_to_sales(uuid) from public, anon, service_role;
revoke all on function public.return_quote_sale_to_quote(uuid) from public, anon, service_role;
revoke all on function public.finalize_quote_sale(uuid,jsonb) from public, anon, service_role;
revoke all on function public.cancel_quote(uuid,text) from public, anon, service_role;
revoke all on function public.cancel_sale_with_reason(uuid,text) from public, anon, service_role;
grant execute on function public.send_quote_to_sales(uuid) to authenticated;
grant execute on function public.return_quote_sale_to_quote(uuid) to authenticated;
grant execute on function public.finalize_quote_sale(uuid,jsonb) to authenticated;
grant execute on function public.cancel_quote(uuid,text) to authenticated;
grant execute on function public.cancel_sale_with_reason(uuid,text) to authenticated;
revoke execute on function public.convert_quote_to_sale(uuid) from public, anon, authenticated;
