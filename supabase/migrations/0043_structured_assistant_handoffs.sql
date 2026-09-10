-- Structured, resumable assistant handoff. Apply manually after 0042.
create table if not exists public.assistant_handoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  assistant_job_id uuid references public.assistant_jobs(id) on delete set null,
  trace_id text,
  status text not null default 'pending' check (status in ('pending','assigned','resolved','dismissed')),
  reason_code text not null,
  summary text,
  known_facts jsonb not null default '[]'::jsonb check (jsonb_typeof(known_facts) = 'array'),
  unresolved_facts jsonb not null default '[]'::jsonb check (jsonb_typeof(unresolved_facts) = 'array'),
  candidate_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(candidate_snapshot) = 'array'),
  source_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(source_snapshot) = 'array'),
  assigned_user_id uuid,
  claimed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trace_id is null or length(trace_id) <= 120),
  check (length(reason_code) between 1 and 80),
  check (summary is null or length(summary) <= 2000)
);

create unique index if not exists assistant_handoffs_active_conversation_uidx
  on public.assistant_handoffs(company_id, conversation_id)
  where status in ('pending','assigned');
create index if not exists assistant_handoffs_company_status_idx
  on public.assistant_handoffs(company_id, status, created_at desc);

drop trigger if exists assistant_handoffs_set_updated_at on public.assistant_handoffs;
create trigger assistant_handoffs_set_updated_at
before update on public.assistant_handoffs
for each row execute function public.set_updated_at();

alter table public.assistant_handoffs enable row level security;
revoke all on table public.assistant_handoffs from anon;
grant select, insert, update on table public.assistant_handoffs to authenticated;
grant select, insert, update on table public.assistant_handoffs to service_role;

drop policy if exists assistant_handoffs_select on public.assistant_handoffs;
drop policy if exists assistant_handoffs_manage on public.assistant_handoffs;
create policy assistant_handoffs_select on public.assistant_handoffs
for select to authenticated
using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'));
create policy assistant_handoffs_manage on public.assistant_handoffs
for all to authenticated
using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'))
with check (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'));

create or replace function public.create_assistant_handoff(
  target_company uuid,
  target_conversation uuid,
  target_job uuid default null,
  target_trace text default null,
  target_reason text default 'human_review_required',
  target_summary text default null,
  target_known_facts jsonb default null,
  target_unresolved_facts jsonb default null,
  target_candidates jsonb default null,
  target_sources jsonb default null
)
returns public.assistant_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare result public.assistant_handoffs;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and public.current_company_role(target_company) not in ('admin','gestor','comercial','vendedor','atendimento') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.conversations c where c.id = target_conversation and c.company_id = target_company) then
    raise exception 'INVALID_HANDOFF_SCOPE';
  end if;
  if target_job is not null and not exists (
    select 1 from public.assistant_jobs j
    where j.id = target_job and j.company_id = target_company and j.conversation_id = target_conversation
  ) then
    raise exception 'INVALID_HANDOFF_JOB_SCOPE';
  end if;
  if target_reason is null or target_reason !~ '^[A-Za-z0-9_.-]{1,80}$' then raise exception 'INVALID_HANDOFF_REASON'; end if;
  if jsonb_typeof(coalesce(target_known_facts, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(target_unresolved_facts, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(target_candidates, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(target_sources, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_HANDOFF_DOSSIER';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_conversation::text, 0));
  select * into result from public.assistant_handoffs
  where company_id = target_company and conversation_id = target_conversation and status in ('pending','assigned')
  order by created_at desc limit 1 for update;

  if result.id is null then
    insert into public.assistant_handoffs(
      company_id, conversation_id, assistant_job_id, trace_id, reason_code, summary,
      known_facts, unresolved_facts, candidate_snapshot, source_snapshot
    ) values (
      target_company, target_conversation, target_job, left(target_trace, 120), target_reason,
      left(target_summary, 2000), coalesce(target_known_facts, '[]'::jsonb),
      coalesce(target_unresolved_facts, '[]'::jsonb), coalesce(target_candidates, '[]'::jsonb),
      coalesce(target_sources, '[]'::jsonb)
    ) returning * into result;
  else
    update public.assistant_handoffs
    set assistant_job_id = coalesce(target_job, assistant_job_id),
        trace_id = coalesce(left(target_trace, 120), trace_id),
        reason_code = target_reason,
        summary = coalesce(left(target_summary, 2000), summary),
        known_facts = coalesce(target_known_facts, known_facts),
        unresolved_facts = coalesce(target_unresolved_facts, unresolved_facts),
        candidate_snapshot = coalesce(target_candidates, candidate_snapshot),
        source_snapshot = coalesce(target_sources, source_snapshot)
    where id = result.id returning * into result;
  end if;

  update public.conversations set status = 'waiting_human'
  where id = target_conversation and company_id = target_company;
  return result;
end;
$$;

create or replace function public.claim_assistant_handoff(target_company uuid, target_handoff uuid)
returns public.assistant_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare result public.assistant_handoffs;
begin
  if auth.uid() is null or public.current_company_role(target_company) not in ('admin','gestor','comercial','vendedor','atendimento') then raise exception 'FORBIDDEN'; end if;
  update public.assistant_handoffs
  set status = 'assigned', assigned_user_id = auth.uid(), claimed_at = coalesce(claimed_at, now())
  where id = target_handoff and company_id = target_company
    and status in ('pending','assigned')
    and (assigned_user_id is null or assigned_user_id = auth.uid())
  returning * into result;
  if result.id is null then raise exception 'HANDOFF_NOT_AVAILABLE'; end if;
  update public.conversations set status = 'in_progress', assigned_user_id = auth.uid()
  where id = result.conversation_id and company_id = target_company;
  return result;
end;
$$;

create or replace function public.resolve_assistant_handoff(target_company uuid, target_handoff uuid, target_status text default 'resolved')
returns public.assistant_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare result public.assistant_handoffs;
begin
  if auth.uid() is null or public.current_company_role(target_company) not in ('admin','gestor','comercial','vendedor','atendimento') then raise exception 'FORBIDDEN'; end if;
  if target_status not in ('resolved','dismissed') then raise exception 'INVALID_HANDOFF_STATUS'; end if;
  update public.assistant_handoffs
  set status = target_status, resolved_at = now(), assigned_user_id = coalesce(assigned_user_id, auth.uid())
  where id = target_handoff and company_id = target_company and status in ('pending','assigned')
  returning * into result;
  if result.id is null then raise exception 'HANDOFF_NOT_AVAILABLE'; end if;
  return result;
end;
$$;

revoke all on function public.create_assistant_handoff(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb) from public, anon;
revoke all on function public.claim_assistant_handoff(uuid,uuid) from public, anon;
revoke all on function public.resolve_assistant_handoff(uuid,uuid,text) from public, anon;
grant execute on function public.create_assistant_handoff(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.claim_assistant_handoff(uuid,uuid) to authenticated;
grant execute on function public.resolve_assistant_handoff(uuid,uuid,text) to authenticated;
