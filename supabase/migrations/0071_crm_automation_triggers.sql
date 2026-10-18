-- ETAPA 13: allow the existing automation engine to observe CRM activity signals.
-- Additive only: preserves every trigger type already accepted by the platform.
alter table public.automations
  drop constraint if exists automations_trigger_type_check;

alter table public.automations
  add constraint automations_trigger_type_check check (
    trigger_type in (
      'new_sale',
      'new_lead',
      'quote_created',
      'quote_approved',
      'quote_no_response',
      'stock_below_min',
      'bill_due',
      'bill_overdue',
      'client_inactive',
      'goal_reached',
      'assistant_job_queued',
      'crm_activity_due_soon',
      'crm_activity_due_today',
      'crm_activity_overdue',
      'crm_opportunity_without_next_action'
    )
  );
-- Conceptual rollback: restore the exact prior automations_trigger_type_check
-- constraint from the database/migration history. This requires first finding
-- and migrating any automations using the new CRM trigger values; changing
-- those values is a data decision and is not losslessly reversible without a
-- snapshot. The DROP/ADD constraint operation itself changes no rows.
