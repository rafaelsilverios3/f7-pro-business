-- ETAPA 13: allow the existing service-role worker to read CRM signals.
-- No frontend role receives these grants; RLS and tenant predicates remain unchanged.
grant select on public.crm_activities, public.opportunities to service_role;
-- Conceptual rollback: revoke the service_role SELECT grants on crm_activities
-- and opportunities. This is privilege-only and row-reversible; check deployed
-- worker dependencies before revoking, and restore the exact grants if needed.
