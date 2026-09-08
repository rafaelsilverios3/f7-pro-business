-- Backend-only execution rights used by whatsapp-send.
-- These SECURITY DEFINER functions keep their own authorization logic.
grant execute on function public.company_has_feature(uuid, text) to service_role;
grant execute on function public.consume_rate_limit(uuid, uuid, text, integer, integer) to service_role;
