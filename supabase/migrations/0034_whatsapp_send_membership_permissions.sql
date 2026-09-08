-- Allows the server-side whatsapp-send function to validate company membership.
-- Does not grant write access and does not change RLS/user permissions.
grant select on table public.company_users to service_role;
