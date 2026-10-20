-- Supabase-native extensions used by the recurring billing scheduler.
-- This migration installs extension objects only; it does not schedule a job.
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Conceptual rollback: first unschedule f7-billing-subscription-reconcile and
-- confirm that no requests remain in flight. Drop pg_net and pg_cron only if
-- no other project jobs or features depend on them. Never remove billing
-- subscriptions, payment rows, webhook events, or reconciliation audit data.
commit;
