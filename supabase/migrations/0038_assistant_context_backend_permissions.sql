-- assistant-suggest reads the company catalog server-side. Keep this grant
-- read-only and do not change user-facing grants or RLS policies.
grant select on table public.products to service_role;
