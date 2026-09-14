-- ETAPA 13: allow the existing service-role worker to read CRM signals.
-- No frontend role receives these grants; RLS and tenant predicates remain unchanged.
grant select on public.crm_activities, public.opportunities to service_role;
