-- Backend-only privileges required by whatsapp-webhook.
-- This migration is incremental and does not change user-facing grants or disable RLS.

grant select on table public.company_integrations to service_role;
grant select on table public.customers to service_role;
grant select, insert, update on table public.whatsapp_contacts to service_role;
grant select, insert, update on table public.conversations to service_role;
grant select, insert, update on table public.messages to service_role;
grant insert on table public.integration_logs to service_role;

-- increment_usage is SECURITY DEFINER and is invoked by the webhook through PostgREST.
-- Keep it unavailable to anonymous callers while allowing the server-side client to call it.
grant execute on function public.increment_usage(uuid, text, date, integer) to service_role;