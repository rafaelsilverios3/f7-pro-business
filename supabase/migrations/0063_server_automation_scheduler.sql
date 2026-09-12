-- ETAPA 63: scheduler server-side idempotente para automações assistidas.
-- Aplicar sem reset: a instalação é aditiva e preserva o histórico existente.
alter table public.automations
  add column if not exists schedule_frequency text not null default 'manual',
  add column if not exists schedule_weekday smallint,
  add column if not exists schedule_time time not null default '08:00',
  add column if not exists timezone text not null default 'UTC',
  add column if not exists next_run_at timestamptz,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_result jsonb not null default '{}'::jsonb,
  add column if not exists failure_count integer not null default 0,
  add column if not exists retry_count integer not null default 0,
  add column if not exists claim_token text,
  add column if not exists claim_until timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.automations drop constraint if exists automations_schedule_frequency_check;
alter table public.automations add constraint automations_schedule_frequency_check check (schedule_frequency in ('manual','daily','weekly'));
alter table public.automations drop constraint if exists automations_schedule_weekday_check;
alter table public.automations add constraint automations_schedule_weekday_check check (schedule_weekday is null or schedule_weekday between 0 and 6);
alter table public.automations drop constraint if exists automations_schedule_time_check;
alter table public.automations add constraint automations_schedule_time_check check (schedule_frequency = 'manual' or schedule_time is not null);
alter table public.automations drop constraint if exists automations_scheduler_counters_check;
alter table public.automations add constraint automations_scheduler_counters_check check (failure_count >= 0 and retry_count >= 0);
create index if not exists automations_due_idx on public.automations(next_run_at, schedule_frequency) where active = true and deleted_at is null;
create index if not exists automation_claim_idx on public.automations(claim_until) where claim_token is not null;

alter table public.automation_runs
  add column if not exists scheduled_for timestamptz,
  add column if not exists trigger text,
  add column if not exists duration_ms integer,
  add column if not exists signals_count integer not null default 0,
  add column if not exists opportunities_created integer not null default 0,
  add column if not exists opportunities_updated integer not null default 0,
  add column if not exists retry_count integer not null default 0,
  add column if not exists stalled_at timestamptz;
create index if not exists automation_runs_scheduled_idx on public.automation_runs(company_id, scheduled_for desc);

create or replace function public.calculate_automation_next_run(
  target_frequency text,
  target_weekday smallint default null,
  target_time time default '08:00',
  target_timezone text default 'UTC',
  anchor timestamptz default now()
) returns timestamptz
language plpgsql immutable security definer set search_path = public as $$
declare zone text := case when target_timezone ~ '^[A-Za-z_]+(/[A-Za-z_]+)+$' then target_timezone else 'UTC' end;
  local_anchor timestamp := anchor at time zone zone; candidate timestamp; current_dow integer; delta integer;
begin
  if target_frequency = 'daily' then
    candidate := date_trunc('day', local_anchor) + (coalesce(target_time, '08:00'::time) - time '00:00');
    if candidate <= local_anchor then candidate := candidate + interval '1 day'; end if;
  elsif target_frequency = 'weekly' and target_weekday between 0 and 6 then
    current_dow := extract(dow from local_anchor)::integer;
    delta := (target_weekday - current_dow + 7) % 7;
    candidate := date_trunc('day', local_anchor) + (delta || ' days')::interval + (coalesce(target_time, '08:00'::time) - time '00:00');
    if candidate <= local_anchor then candidate := candidate + interval '7 days'; end if;
  else
    return null;
  end if;
  return candidate at time zone zone;
end;
$$;
revoke all on function public.calculate_automation_next_run(text, smallint, time, text, timestamptz) from public, anon;
grant execute on function public.calculate_automation_next_run(text, smallint, time, text, timestamptz) to authenticated, service_role;

create or replace function public.claim_due_automations(batch_size integer default 20)
returns table(id uuid, company_id uuid, name text, trigger_type text, conditions jsonb, actions jsonb, schedule_frequency text, schedule_weekday smallint, schedule_time time, timezone text, next_run_at timestamptz, claim_token text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select a.id from public.automations a
    where a.active and a.deleted_at is null and a.schedule_frequency <> 'manual'
      and a.next_run_at is not null and a.next_run_at <= now()
      and (a.claim_until is null or a.claim_until < now())
    order by a.next_run_at asc
    for update skip locked limit greatest(1, least(coalesce(batch_size, 20), 100))
  ), claimed as (
    update public.automations a set claim_token = gen_random_uuid()::text, claim_until = now() + interval '10 minutes', updated_at = now()
    from due where a.id = due.id returning a.*
  )
  select c.id, c.company_id, c.name, c.trigger_type, c.conditions, c.actions, c.schedule_frequency, c.schedule_weekday, c.schedule_time, c.timezone, c.next_run_at, c.claim_token from claimed c;
end;
$$;
revoke all on function public.claim_due_automations(integer) from public, anon, authenticated;
grant execute on function public.claim_due_automations(integer) to service_role;

create or replace function public.release_automation_claim(target_id uuid, target_token text, target_next_run timestamptz, target_result jsonb default '{}'::jsonb, target_failed boolean default false)
returns boolean language sql security definer set search_path = public as $$
  update public.automations set claim_token = null, claim_until = null, next_run_at = target_next_run, last_run_at = now(), last_result = coalesce(target_result, '{}'::jsonb), failure_count = case when target_failed then failure_count + 1 else 0 end, retry_count = case when target_failed then retry_count + 1 else 0 end, updated_at = now()
  where id = target_id and claim_token = target_token returning true;
$$;
revoke all on function public.release_automation_claim(uuid, text, timestamptz, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.release_automation_claim(uuid, text, timestamptz, jsonb, boolean) to service_role;

comment on column public.automations.schedule_frequency is 'manual, daily or weekly; scheduler never accepts arbitrary cron text';
comment on column public.automations.claim_token is 'short-lived server-side claim used by the scheduler dispatcher';

-- Vendedores podem consultar o calendário e o histórico, mas somente admin/gestor alteram regras.
drop policy if exists automations_select on public.automations;
create policy automations_select on public.automations for select to authenticated
  using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor'));
