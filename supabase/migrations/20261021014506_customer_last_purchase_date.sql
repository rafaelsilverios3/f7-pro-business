-- Keep the customer summary field used by checkout and customer intelligence
-- in sync with the sale ledger. Older installations may have the column
-- missing even though sale RPCs already write it.
alter table public.customers
  add column if not exists last_purchase_date date;

update public.customers c
set last_purchase_date = latest.sale_date
from (
  select company_id, customer_id, max(sale_date) as sale_date
  from public.sales
  where status = 'completed' and customer_id is not null
  group by company_id, customer_id
) latest
where c.company_id = latest.company_id
  and c.id = latest.customer_id
  and c.last_purchase_date is null;

create index if not exists idx_customers_company_last_purchase
  on public.customers(company_id, last_purchase_date desc)
  where last_purchase_date is not null;
