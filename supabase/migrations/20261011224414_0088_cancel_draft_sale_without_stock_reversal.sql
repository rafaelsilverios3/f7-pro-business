-- Draft sales created by create_draft_sale do not reserve or decrement stock.
-- Cancel them without creating stock, finance, commission, or customer ledger
-- changes. Completed sales keep the existing cancellation/compensation flow.
-- Conceptual rollback: restore the prior cancel_sale(uuid) body only after all
-- draft rows are resolved; the old body incorrectly reverses stock for drafts.
-- This migration changes no existing application rows.

create or replace function public.cancel_sale(target_sale uuid)
returns public.sales
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result public.sales;
  previous_sale public.sales;
  item jsonb;
  variant uuid;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;

  select * into result
  from public.sales
  where id = target_sale
    and public.is_company_member(company_id)
  for update;

  if result.id is null then raise exception 'Venda não encontrada'; end if;
  if public.current_company_role(result.company_id) not in ('admin', 'gestor', 'comercial', 'vendedor') then
    raise exception 'Sem permissão para cancelar venda';
  end if;
  if result.status = 'cancelled' then return result; end if;

  previous_sale := result;

  -- Draft RPCs do not affect inventory or financial/customer aggregates.
  -- This early return is deliberately before the stock restoration loop below.
  if result.status = 'draft' then
    update public.sales
    set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
    where id = result.id and company_id = result.company_id
    returning * into result;

    insert into public.audit_logs(company_id, user_id, action, entity, entity_id, old_data, new_data)
    values (result.company_id, auth.uid(), 'sale.draft_cancelled', 'Sale', result.id, to_jsonb(previous_sale), to_jsonb(result));
    return result;
  end if;

  for item in select * from jsonb_array_elements(result.items) loop
    if coalesce(item->>'item_type', 'product') = 'product' then
      variant := nullif(item->>'variant_id', '')::uuid;
      if variant is null then
        update public.products
        set stock = stock + (item->>'qty')::numeric
        where id = (item->>'product_id')::uuid and company_id = result.company_id;
      else
        update public.product_variants
        set stock = stock + (item->>'qty')::numeric, updated_at = now()
        where id = variant and company_id = result.company_id;
      end if;
      insert into public.stock_movements(company_id, product_id, variant_id, sale_id, type, quantity, reason)
      values (result.company_id, (item->>'product_id')::uuid, variant, result.id, 'in', (item->>'qty')::numeric, 'Estorno de venda');
    end if;
  end loop;

  update public.financial_entries set status = 'cancelled' where sale_id = result.id and status <> 'cancelled';
  update public.commissions set status = 'reversed' where sale_id = result.id and status <> 'reversed';
  if result.customer_id is not null then
    update public.customers
    set total_purchased = greatest(0, total_purchased - result.total),
        sale_count = greatest(0, sale_count - 1),
        avg_ticket = case when sale_count > 1 then round(greatest(0, total_purchased - result.total) / greatest(1, sale_count - 1), 2) else 0 end,
        last_purchase_date = (
          select max(s.sale_date) from public.sales s
          where s.company_id = result.company_id and s.customer_id = result.customer_id
            and s.id <> result.id and s.status = 'completed'
        ),
        updated_at = now()
    where id = result.customer_id and company_id = result.company_id;
  end if;

  update public.sales
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where id = result.id
  returning * into result;

  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, old_data, new_data)
  values (result.company_id, auth.uid(), 'sale.cancelled', 'Sale', result.id, to_jsonb(previous_sale), to_jsonb(result));
  return result;
end;
$$;

revoke all on function public.cancel_sale(uuid) from public, anon, service_role;
grant execute on function public.cancel_sale(uuid) to authenticated;
