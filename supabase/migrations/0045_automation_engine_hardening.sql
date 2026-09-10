-- Harden the TRIGGER -> CONDITION -> ACTION engine. Apply manually after 0044.
alter table public.automation_runs
  add column if not exists trace_id text,
  add column if not exists event_id text,
  add column if not exists action_count integer not null default 0 check (action_count >= 0),
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists safe_error_code text;

update public.automation_runs set event_id = nullif(trigger_data->>'event_id', '') where event_id is null and jsonb_typeof(trigger_data) = 'object';
update public.automations set conditions = '[]'::jsonb where conditions = '{}'::jsonb;
alter table public.automations alter column conditions set default '[]'::jsonb;
alter table public.automations drop constraint if exists automations_trigger_type_check;
alter table public.automations add constraint automations_trigger_type_check check (trigger_type in ('new_sale','new_lead','quote_created','quote_approved','quote_no_response','stock_below_min','bill_due','bill_overdue','client_inactive','goal_reached','assistant_job_queued'));
alter table public.automations drop constraint if exists automations_conditions_shape_check;
alter table public.automations add constraint automations_conditions_shape_check check (jsonb_typeof(conditions) in ('array','object'));
alter table public.automations drop constraint if exists automations_actions_shape_check;
alter table public.automations add constraint automations_actions_shape_check check (jsonb_typeof(actions) = 'array');
alter table public.automation_runs drop constraint if exists automation_runs_status_check;
update public.automation_runs set status = case when status in ('executed','success') then 'completed' when status = 'error' then 'failed' when status = 'ignored' then 'skipped' else status end where status in ('executed','success','error','ignored');
alter table public.automation_runs add constraint automation_runs_status_check check (status in ('processing','completed','skipped','blocked','failed'));
create index if not exists automation_runs_company_created_idx on public.automation_runs(company_id, created_at desc);
create index if not exists automations_company_trigger_active_idx on public.automations(company_id, trigger_type) where active = true;

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
drop policy if exists company_isolation on public.automations;
drop policy if exists company_isolation on public.automation_runs;
drop policy if exists automations_select on public.automations;
drop policy if exists automations_manage on public.automations;
drop policy if exists automation_runs_select on public.automation_runs;
create policy automations_select on public.automations for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor','comercial'));
create policy automations_manage on public.automations for all to authenticated using (public.current_company_role(company_id) in ('admin','gestor')) with check (public.current_company_role(company_id) in ('admin','gestor'));
create policy automation_runs_select on public.automation_runs for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor'));
revoke insert, update, delete on public.automation_runs from authenticated;
revoke all on public.automations, public.automation_runs from anon;
grant select, insert, update, delete on public.automations to authenticated;
grant select on public.automation_runs to authenticated;
grant select on public.automations to service_role;
grant select, insert, update on public.automation_runs to service_role;
grant insert on public.notifications to service_role;

-- Conceptual rollback: pause all automations, undeploy automation-worker, restore the prior
-- policies/grants, then remove only the columns, checks and indexes introduced above.
-- Keep automation_runs rows as the audit record; do not delete execution history.
