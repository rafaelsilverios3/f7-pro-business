-- Backend-only access for WhatsApp integration state and audit logs.
-- This migration is intentionally idempotent and does not disable RLS.

alter table if exists public.company_integrations enable row level security;
alter table if exists public.integration_logs enable row level security;

grant select, insert, update on table public.company_integrations to service_role;
grant select, insert on table public.integration_logs to service_role;

revoke insert, update, delete on table public.company_integrations from authenticated;
revoke insert, update, delete on table public.integration_logs from authenticated;
revoke insert, update, delete on table public.company_integrations from anon;
revoke insert, update, delete on table public.integration_logs from anon;

