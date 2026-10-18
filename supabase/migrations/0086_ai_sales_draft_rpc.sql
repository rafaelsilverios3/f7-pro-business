-- Conceptual rollback: revoke the RPC and drop it only after the dependent
-- Edge Function is rolled back. Draft rows created while it was active remain.
-- No direct table grants are added; sales writes stay behind this validated RPC.
create or replace function public.create_draft_sale(sale_payload jsonb)
returns public.sales
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  company uuid := nullif(sale_payload->>'company_id', '')::uuid;
  product_id uuid := nullif(sale_payload->>'product_id', '')::uuid;
  customer uuid := nullif(sale_payload->>'customer_id', '')::uuid;
  quantity numeric := (sale_payload->>'quantity')::numeric;
  confirmed boolean := coalesce((sale_payload->>'confirmed')::boolean, false);
  v_idempotency_key text := nullif(trim(sale_payload->>'idempotency_key'), '');
  product_row public.products;
  existing public.sales;
  sale_row public.sales;
  unit_price numeric(14,2);
  unit_cost numeric(14,2);
  subtotal numeric(14,2);
  cost_total numeric(14,2);
  draft_items jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  if company is null or product_id is null or quantity is null or quantity <= 0 or quantity > 10000 or quantity <> round(quantity, 3) then
    raise exception 'Rascunho de pedido inválido.';
  end if;
  if not confirmed then raise exception 'Confirmação humana obrigatória para criar o rascunho.'; end if;
  if not public.is_company_member(company) then raise exception 'Usuário não pertence à empresa'; end if;
  if public.current_company_role(company) not in ('admin', 'gestor', 'comercial', 'vendedor') then
    raise exception 'Sem permissão para criar rascunhos';
  end if;
  if not public.company_has_feature(company, 'ai_sales') then raise exception 'Sales Assistant não está habilitado para esta empresa'; end if;
  if v_idempotency_key is not null and length(v_idempotency_key) > 200 then raise exception 'Chave de idempotência inválida'; end if;

  -- Serialize retries using this key, including concurrent requests where the
  -- initial lookup sees no row yet. The unique constraint remains the backstop.
  if v_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(company::text || ':' || v_idempotency_key, 0));
  end if;

  if customer is not null and not exists (
    select 1 from public.customers where id = customer and company_id = company
  ) then
    raise exception 'Cliente não encontrado.';
  end if;

  if v_idempotency_key is not null then
    select * into existing
    from public.sales
    where company_id = company and sales.idempotency_key = v_idempotency_key
    for update;
    if existing.id is not null then
      if existing.status = 'draft'
        and existing.customer_id is not distinct from customer
        and existing.items->0->>'product_id' = product_id::text
        and (existing.items->0->>'qty')::numeric = quantity then
        return existing;
      end if;
      raise exception 'Chave de idempotência já utilizada por outro pedido';
    end if;
  end if;

  select * into product_row
  from public.products
  where id = product_id and company_id = company and active
  for update;
  if product_row.id is null then raise exception 'Produto não encontrado.'; end if;
  if product_row.stock < quantity then raise exception 'Estoque insuficiente para criar o rascunho.'; end if;

  unit_price := greatest(0, coalesce(product_row.price, 0));
  unit_cost := greatest(0, coalesce(product_row.cost, 0));
  subtotal := round(unit_price * quantity, 2);
  cost_total := round(unit_cost * quantity, 2);
  draft_items := jsonb_build_array(jsonb_build_object(
    'product_id', product_row.id,
    'name', product_row.name,
    'qty', quantity,
    'quantity', quantity,
    'price', unit_price,
    'cost', unit_cost
  ));

  insert into public.sales(company_id, customer_id, status, items, subtotal, total, discount, addition, cost_total, profit, idempotency_key)
  values (company, customer, 'draft', draft_items, subtotal, subtotal, 0, 0, cost_total, subtotal - cost_total, v_idempotency_key)
  returning * into sale_row;

  begin
    insert into public.audit_logs(company_id, user_id, action, entity, entity_id, new_data)
    values (company, auth.uid(), 'sales_assistant.draft_created', 'Sale', sale_row.id, to_jsonb(sale_row));
  exception when others then
    -- Audit storage is best effort, matching the existing assistant behavior.
    null;
  end;

  return sale_row;
end;
$$;

revoke all on function public.create_draft_sale(jsonb) from public, anon, service_role;
grant execute on function public.create_draft_sale(jsonb) to authenticated;
