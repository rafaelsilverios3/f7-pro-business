-- Allow the server-side assistant suggestion function to read company-scoped
-- configuration. No user-facing role or RLS policy is changed here.
grant select on table public.company_assistant_settings to service_role;
grant select on table public.company_quick_replies to service_role;
grant select on table public.company_handoff_rules to service_role;
