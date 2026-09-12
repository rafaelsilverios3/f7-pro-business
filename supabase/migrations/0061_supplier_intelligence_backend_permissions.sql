-- Supplier Intelligence persists only through the authenticated Edge Function.
-- Keep client roles unchanged; grant the backend service role the minimum DML
-- needed for the explicit human-confirmed save action and its profile record.
grant select, insert, update on public.suppliers to service_role;
grant select, insert, update on public.supplier_intelligence_profiles to service_role;
