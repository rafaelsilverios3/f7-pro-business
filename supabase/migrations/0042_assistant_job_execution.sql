-- Complete the already-applied 0041 assistant job foundation without enabling automatic replies.
-- `allow_product_lookup` is the canonical catalog lookup switch created by 0041.
alter table public.company_assistant_settings
  add column if not exists allow_official_sources boolean not null default true,
  add column if not exists allow_customer_lookup boolean not null default false,
  add column if not exists allow_quote_draft boolean not null default false,
  add column if not exists max_research_time_ms integer not null default 20000 check (max_research_time_ms between 1000 and 60000),
  add column if not exists max_research_cost numeric(10,4) not null default 0.0500 check (max_research_cost >= 0 and max_research_cost <= 100);

alter table public.assistant_jobs
  add column if not exists message_id uuid references public.messages(id) on delete cascade,
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists error_code text,
  add column if not exists error_stage text,
  add column if not exists delivery_started_at timestamptz;

alter table public.assistant_jobs drop constraint if exists assistant_jobs_status_check;
alter table public.assistant_jobs
  add constraint assistant_jobs_status_check
  check (status in ('queued','processing','waiting_input','completed','failed','handed_off'));

create unique index if not exists assistant_jobs_company_message_uidx
  on public.assistant_jobs(company_id, message_id)
  where message_id is not null;
create index if not exists assistant_jobs_claim_idx
  on public.assistant_jobs(status, next_attempt_at, created_at)
  where status = 'queued';

create or replace function public.enqueue_assistant_job(
  target_company uuid,
  target_conversation uuid,
  target_message uuid,
  target_provider_message text
)
returns public.assistant_jobs
language plpgsql
security definer
set search_path = public
as $$
declare queued public.assistant_jobs;
begin
  if target_provider_message is null or length(target_provider_message) > 500 then
    raise exception 'INVALID_PROVIDER_MESSAGE_ID';
  end if;
  if not exists (
    select 1 from public.messages m
    where m.id = target_message and m.company_id = target_company and m.conversation_id = target_conversation and m.sender_type = 'customer'
  ) then
    raise exception 'INVALID_ASSISTANT_JOB_SCOPE';
  end if;
  insert into public.assistant_jobs(company_id, conversation_id, message_id, provider_message_id, status)
  values (target_company, target_conversation, target_message, target_provider_message, 'queued')
  on conflict (company_id, provider_message_id) do update
    set message_id = coalesce(public.assistant_jobs.message_id, excluded.message_id)
  returning * into queued;
  return queued;
end;
$$;

create or replace function public.claim_assistant_job(target_job uuid default null)
returns public.assistant_jobs
language plpgsql
security definer
set search_path = public
as $$
declare claimed public.assistant_jobs;
begin
  with candidate as (
    select id from public.assistant_jobs
    where status = 'queued'
      and next_attempt_at <= now()
      and (target_job is null or id = target_job)
    order by created_at
    for update skip locked
    limit 1
  )
  update public.assistant_jobs j
    set status = 'processing', attempt_count = attempt_count + 1, started_at = now(), error_code = null, error_stage = null
  from candidate
  where j.id = candidate.id
  returning j.* into claimed;
  return claimed;
end;
$$;

create or replace function public.authorize_assistant_job_delivery(target_job uuid, target_trace text, target_decision jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare authorized boolean;
begin
  update public.assistant_jobs
  set delivery_started_at = now(), trace_id = left(target_trace, 120), decision = target_decision
  where id = target_job and status = 'processing' and delivery_started_at is null
  returning true into authorized;
  return coalesce(authorized, false);
end;
$$;

create or replace function public.finish_assistant_job(
  target_job uuid,
  target_status text,
  target_response_message uuid default null,
  target_error_code text default null,
  target_error_stage text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_status not in ('queued','waiting_input','completed','failed','handed_off') then raise exception 'INVALID_ASSISTANT_JOB_STATUS'; end if;
  update public.assistant_jobs
  set status = target_status,
      response_message_id = target_response_message,
      error_code = case when target_error_code is null then null else left(target_error_code, 80) end,
      error_stage = case when target_error_stage is null then null else left(target_error_stage, 80) end,
      processed_at = case when target_status in ('completed','failed','handed_off') then now() else processed_at end,
      finished_at = case when target_status in ('completed','failed','handed_off') then now() else null end,
      next_attempt_at = case when target_status = 'queued' then now() + interval '30 seconds' else next_attempt_at end
  where id = target_job and status = 'processing';
  return found;
end;
$$;

revoke all on function public.enqueue_assistant_job(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.claim_assistant_job(uuid) from public, anon, authenticated;
revoke all on function public.authorize_assistant_job_delivery(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.finish_assistant_job(uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.enqueue_assistant_job(uuid,uuid,uuid,text) to service_role;
grant execute on function public.claim_assistant_job(uuid) to service_role;
grant execute on function public.authorize_assistant_job_delivery(uuid,text,jsonb) to service_role;
grant execute on function public.finish_assistant_job(uuid,text,uuid,text,text) to service_role;

alter table public.assistant_jobs enable row level security;
revoke all on public.assistant_jobs from anon, authenticated;
grant select, insert, update on public.assistant_jobs to service_role;
