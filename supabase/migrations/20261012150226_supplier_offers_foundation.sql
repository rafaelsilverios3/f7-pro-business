-- Conceptual rollback: this migration creates an isolated offer registry and
-- guarded RPCs; it does not rewrite existing commercial data. Before any offer
-- data is recorded, a rollback can revoke the three RPC grants and remove the
-- new table/functions. After offers or audit entries exist, do not drop them:
-- disable the UI, keep the records, and correct forward to preserve provenance.
-- No stock, purchase, sale, pricing, subscription, or marketplace rows change.

begin;

create table public.supplier_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null,
  product_id uuid not null,
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  supplier_quantity numeric(14,3) check (supplier_quantity is null or supplier_quantity >= 0),
  minimum_order_quantity numeric(14,3) not null default 1 check (minimum_order_quantity > 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'supplier_intelligence', 'csv', 'xml', 'api')),
  source_url text check (source_url is null or (length(source_url) <= 2048 and source_url ~* '^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$')),
  source_note text check (source_note is null or length(source_note) <= 1000),
  observed_at date not null default current_date,
  valid_until date,
  status text not null default 'draft'
    check (status in ('draft', 'pending_verification', 'verified', 'approved', 'suspended', 'expired')),
  verification_note text check (verification_note is null or length(verification_note) <= 1000),
  verified_at timestamptz,
  verified_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  suspended_at timestamptz,
  suspended_by uuid,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  constraint supplier_offers_company_supplier_fk
    foreign key (company_id, supplier_id)
    references public.suppliers(company_id, id) on delete restrict,
  constraint supplier_offers_company_product_fk
    foreign key (company_id, product_id)
    references public.products(company_id, id) on delete restrict,
  constraint supplier_offers_verified_fields_check
    check ((verified_at is null and verified_by is null) or (verified_at is not null and verified_by is not null)),
  constraint supplier_offers_approved_fields_check
    check ((approved_at is null and approved_by is null) or (approved_at is not null and approved_by is not null)),
  constraint supplier_offers_suspended_fields_check
    check ((suspended_at is null and suspended_by is null) or (suspended_at is not null and suspended_by is not null)),
  constraint supplier_offers_verified_state_check
    check (status not in ('verified', 'approved') or (verified_at is not null and verified_by is not null and length(btrim(coalesce(verification_note, ''))) >= 3)),
  constraint supplier_offers_approved_state_check
    check (status <> 'approved' or (approved_at is not null and approved_by is not null and valid_until is not null)),
  constraint supplier_offers_suspended_state_check
    check (status <> 'suspended' or (suspended_at is not null and suspended_by is not null)),
  constraint supplier_offers_expired_state_check
    check (status <> 'expired' or valid_until is not null)
);

create index supplier_offers_company_product_status_idx
  on public.supplier_offers(company_id, product_id, status, currency);
create index supplier_offers_company_supplier_created_idx
  on public.supplier_offers(company_id, supplier_id, created_at desc);

alter table public.supplier_offers enable row level security;
create policy supplier_offers_tenant_read
  on public.supplier_offers for select to authenticated
  using (public.current_company_role(company_id) in ('admin', 'gestor', 'estoque'));

-- No direct browser or service-role DML: all mutations pass through the
-- authenticated, tenant-checked, audited RPCs below.
revoke all on table public.supplier_offers from public, anon, authenticated, service_role;
grant select on table public.supplier_offers to authenticated;

create function public.create_supplier_offer(
  p_company_id uuid,
  p_supplier_id uuid,
  p_product_id uuid,
  p_unit_cost numeric,
  p_currency text default 'BRL',
  p_supplier_quantity numeric default null,
  p_minimum_order_quantity numeric default 1,
  p_lead_time_days integer default null,
  p_source_type text default 'manual',
  p_source_url text default null,
  p_source_note text default null,
  p_observed_at date default current_date,
  p_valid_until date default null
)
returns public.supplier_offers
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor_role text;
  result public.supplier_offers;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  actor_role := public.current_company_role(p_company_id);
  if actor_role is null or actor_role not in ('admin', 'gestor', 'estoque') then raise exception 'Sem permissão para gerenciar ofertas'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Custo unitário inválido'; end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then raise exception 'Moeda deve usar um código de três letras maiúsculas'; end if;
  if p_supplier_quantity is not null and p_supplier_quantity < 0 then raise exception 'Quantidade informada pelo fornecedor inválida'; end if;
  if p_minimum_order_quantity is null or p_minimum_order_quantity <= 0 then raise exception 'Pedido mínimo deve ser maior que zero'; end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then raise exception 'Prazo de fornecimento inválido'; end if;
  if p_source_type not in ('manual', 'supplier_intelligence', 'csv', 'xml', 'api') then raise exception 'Origem da oferta inválida'; end if;
  if p_source_url is not null and (length(p_source_url) > 2048 or p_source_url !~* '^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$') then raise exception 'A origem deve ser uma URL HTTPS sem credenciais, query ou fragmento'; end if;
  if p_source_note is not null and length(p_source_note) > 1000 then raise exception 'Observação da origem excede o limite'; end if;
  if p_observed_at is null or p_observed_at > current_date then raise exception 'Data da informação inválida'; end if;
  if p_valid_until is not null and p_valid_until < p_observed_at then raise exception 'Validade não pode anteceder a data da informação'; end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.company_id = p_company_id)
     or not exists (select 1 from public.products p where p.id = p_product_id and p.company_id = p_company_id) then
    raise exception 'Fornecedor ou produto não pertence à empresa';
  end if;

  insert into public.supplier_offers(
    company_id, supplier_id, product_id, unit_cost, currency, supplier_quantity,
    minimum_order_quantity, lead_time_days, source_type, source_url, source_note,
    observed_at, valid_until, created_by
  ) values (
    p_company_id, p_supplier_id, p_product_id, p_unit_cost, p_currency, p_supplier_quantity,
    p_minimum_order_quantity, p_lead_time_days, p_source_type, nullif(btrim(p_source_url), ''),
    nullif(btrim(p_source_note), ''), p_observed_at, p_valid_until, auth.uid()
  ) returning * into result;

  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, new_data)
  values (p_company_id, auth.uid(), 'supplier_offer.created', 'SupplierOffer', result.id,
    jsonb_build_object('supplier_id', result.supplier_id, 'product_id', result.product_id,
      'unit_cost', result.unit_cost, 'currency', result.currency, 'source_type', result.source_type,
      'status', result.status, 'valid_until', result.valid_until));
  return result;
end;
$$;

create function public.update_supplier_offer(
  p_offer_id uuid,
  p_supplier_id uuid,
  p_product_id uuid,
  p_unit_cost numeric,
  p_currency text default 'BRL',
  p_supplier_quantity numeric default null,
  p_minimum_order_quantity numeric default 1,
  p_lead_time_days integer default null,
  p_source_type text default 'manual',
  p_source_url text default null,
  p_source_note text default null,
  p_observed_at date default current_date,
  p_valid_until date default null
)
returns public.supplier_offers
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  previous public.supplier_offers;
  result public.supplier_offers;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into previous from public.supplier_offers o
    where o.id = p_offer_id and public.is_company_member(o.company_id) for update;
  if previous.id is null then raise exception 'Oferta não encontrada'; end if;
  if public.current_company_role(previous.company_id) is null or public.current_company_role(previous.company_id) not in ('admin', 'gestor', 'estoque') then raise exception 'Sem permissão para gerenciar ofertas'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Custo unitário inválido'; end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then raise exception 'Moeda deve usar um código de três letras maiúsculas'; end if;
  if p_supplier_quantity is not null and p_supplier_quantity < 0 then raise exception 'Quantidade informada pelo fornecedor inválida'; end if;
  if p_minimum_order_quantity is null or p_minimum_order_quantity <= 0 then raise exception 'Pedido mínimo deve ser maior que zero'; end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then raise exception 'Prazo de fornecimento inválido'; end if;
  if p_source_type not in ('manual', 'supplier_intelligence', 'csv', 'xml', 'api') then raise exception 'Origem da oferta inválida'; end if;
  if p_source_url is not null and (length(p_source_url) > 2048 or p_source_url !~* '^https://[^/?#@[:space:]]+(/[^?#[:space:]]*)?$') then raise exception 'A origem deve ser uma URL HTTPS sem credenciais, query ou fragmento'; end if;
  if p_source_note is not null and length(p_source_note) > 1000 then raise exception 'Observação da origem excede o limite'; end if;
  if p_observed_at is null or p_observed_at > current_date then raise exception 'Data da informação inválida'; end if;
  if p_valid_until is not null and p_valid_until < p_observed_at then raise exception 'Validade não pode anteceder a data da informação'; end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.company_id = previous.company_id)
     or not exists (select 1 from public.products p where p.id = p_product_id and p.company_id = previous.company_id) then
    raise exception 'Fornecedor ou produto não pertence à empresa';
  end if;

  update public.supplier_offers set
    supplier_id = p_supplier_id, product_id = p_product_id, unit_cost = p_unit_cost,
    currency = p_currency, supplier_quantity = p_supplier_quantity,
    minimum_order_quantity = p_minimum_order_quantity, lead_time_days = p_lead_time_days,
    source_type = p_source_type, source_url = nullif(btrim(p_source_url), ''),
    source_note = nullif(btrim(p_source_note), ''), observed_at = p_observed_at,
    valid_until = p_valid_until, status = 'draft', verification_note = null,
    verified_at = null, verified_by = null, approved_at = null, approved_by = null,
    suspended_at = null, suspended_by = null, updated_at = now()
  where id = previous.id returning * into result;

  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, old_data, new_data)
  values (previous.company_id, auth.uid(), 'supplier_offer.updated', 'SupplierOffer', result.id,
    jsonb_build_object('status', previous.status, 'unit_cost', previous.unit_cost, 'currency', previous.currency,
      'supplier_id', previous.supplier_id, 'product_id', previous.product_id),
    jsonb_build_object('status', result.status, 'unit_cost', result.unit_cost, 'currency', result.currency,
      'supplier_id', result.supplier_id, 'product_id', result.product_id, 'valid_until', result.valid_until));
  return result;
end;
$$;

create function public.transition_supplier_offer(p_offer_id uuid, p_next_status text, p_note text default null)
returns public.supplier_offers
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  previous public.supplier_offers;
  result public.supplier_offers;
  allowed boolean := false;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into previous from public.supplier_offers o
    where o.id = p_offer_id and public.is_company_member(o.company_id) for update;
  if previous.id is null then raise exception 'Oferta não encontrada'; end if;
  if public.current_company_role(previous.company_id) not in ('admin', 'gestor', 'estoque') then raise exception 'Sem permissão para gerenciar ofertas'; end if;
  if p_note is not null and length(p_note) > 1000 then raise exception 'Observação excede o limite'; end if;

  allowed := case
    when p_next_status = 'pending_verification' then previous.status in ('draft', 'suspended')
    when p_next_status = 'verified' then previous.status = 'pending_verification' and length(btrim(coalesce(p_note, ''))) >= 3
    when p_next_status = 'approved' then previous.status = 'verified'
      and previous.verified_at is not null and previous.verified_by is not null
      and previous.valid_until is not null and previous.valid_until >= current_date
      and length(btrim(coalesce(p_note, ''))) >= 3
    when p_next_status = 'suspended' then previous.status in ('pending_verification', 'verified', 'approved')
      and length(btrim(coalesce(p_note, ''))) >= 3
    when p_next_status = 'expired' then previous.status <> 'expired'
      and previous.valid_until is not null and previous.valid_until < current_date
    else false
  end;
  if not allowed then raise exception 'Transição de oferta inválida ou sem evidência suficiente'; end if;

  update public.supplier_offers set
    status = p_next_status,
    verification_note = case when p_next_status = 'verified' then btrim(p_note) else verification_note end,
    verified_at = case when p_next_status = 'verified' then now() else verified_at end,
    verified_by = case when p_next_status = 'verified' then auth.uid() else verified_by end,
    approved_at = case when p_next_status = 'approved' then now() else null end,
    approved_by = case when p_next_status = 'approved' then auth.uid() else null end,
    suspended_at = case when p_next_status = 'suspended' then now() else null end,
    suspended_by = case when p_next_status = 'suspended' then auth.uid() else null end,
    updated_at = now()
  where id = previous.id returning * into result;

  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, old_data, new_data)
  values (previous.company_id, auth.uid(), 'supplier_offer.status_changed', 'SupplierOffer', result.id,
    jsonb_build_object('status', previous.status, 'verified_at', previous.verified_at,
      'approved_at', previous.approved_at, 'suspended_at', previous.suspended_at),
    jsonb_build_object('status', result.status, 'verified_at', result.verified_at,
      'verified_by', result.verified_by, 'approved_at', result.approved_at,
      'approved_by', result.approved_by, 'suspended_at', result.suspended_at,
      'suspended_by', result.suspended_by, 'note', nullif(btrim(p_note), '')));
  return result;
end;
$$;

revoke all on function public.create_supplier_offer(uuid, uuid, uuid, numeric, text, numeric, numeric, integer, text, text, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.update_supplier_offer(uuid, uuid, uuid, numeric, text, numeric, numeric, integer, text, text, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.transition_supplier_offer(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_supplier_offer(uuid, uuid, uuid, numeric, text, numeric, numeric, integer, text, text, text, date, date) to authenticated;
grant execute on function public.update_supplier_offer(uuid, uuid, uuid, numeric, text, numeric, numeric, integer, text, text, text, date, date) to authenticated;
grant execute on function public.transition_supplier_offer(uuid, text, text) to authenticated;

commit;
