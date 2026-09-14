-- Preserve the amount supplied by sale/purchase flows when total_amount is
-- omitted. The column default (0) must not overwrite a positive amount before
-- the financial_entries_amount_positive constraint is evaluated.
-- Conceptual rollback: restore the previous prepare_financial_entry trigger
-- definition from migration 0050_financial_flow.sql.
create or replace function public.prepare_financial_entry() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nature := case when new.type = 'payable' then 'expense' else 'revenue' end;
  if new.total_amount is null or (new.total_amount = 0 and coalesce(new.amount, 0) > 0) then
    new.total_amount := new.amount;
  end if;
  new.amount := new.total_amount;
  if new.nature = 'revenue' then new.paid_amount := 0; end if;
  if new.nature = 'expense' then new.received_amount := 0; end if;
  return new;
end; $$;
