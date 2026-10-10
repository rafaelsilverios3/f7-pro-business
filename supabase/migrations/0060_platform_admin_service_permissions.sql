-- Platform administration reads existing tenant data with the service role.
-- Keep this separate from 0059 because 0059 may already be applied remotely.
grant select on public.companies to service_role;
grant select, insert, update on public.company_subscriptions to service_role;
grant select, update on public.company_users to service_role;
grant select, update on public.company_assistant_settings to service_role;
grant select on public.products, public.customers, public.sales, public.financial_entries to service_role;
-- Conceptual rollback: revoke exactly the service_role grants below. This is
-- structurally reversible and changes no rows, but first confirm no deployed
-- backend depends on these privileges; otherwise restore the grants.
