-- F7 Autonomous Intelligence Core - Level 1 supervised autonomy.
-- Apply manually after 0048_resilient_onboarding.sql. Never run db push blindly.

alter table public.company_assistant_settings
  add column if not exists autonomy_mode text not null default 'ASSISTED',
  add column if not exists max_autonomous_jobs_per_day integer not null default 100 check (max_autonomous_jobs_per_day between 0 and 100000),
  add column if not exists max_autonomous_jobs_per_hour integer not null default 20 check (max_autonomous_jobs_per_hour between 0 and 10000),
  add column if not exists max_tool_calls_per_job integer not null default 8 check (max_tool_calls_per_job between 0 and 100),
  add column if not exists max_model_calls_per_job integer not null default 2 check (max_model_calls_per_job between 0 and 20),
  add column if not exists max_job_runtime_ms integer not null default 60000 check (max_job_runtime_ms between 1000 and 300000),
  add column if not exists max_event_depth integer not null default 3 check (max_event_depth between 0 and 20);

alter table public.company_assistant_settings drop constraint if exists company_assistant_settings_autonomy_mode_check;
alter table public.company_assistant_settings add constraint company_assistant_settings_autonomy_mode_check
  check (autonomy_mode in ('OFF','ASSISTED','SUPERVISED_AUTONOMOUS'));

-- Legacy automatic delivery is retired by Level 1. Existing companies remain
-- assisted and no autonomous external send is authorized by this migration.
update public.company_assistant_settings set automatic_reply_enabled = false
where automatic_reply_enabled = true;
update public.company_assistant_settings set mode = 'assisted'
where mode = 'automatic';

create unique index if not exists conversations_company_id_id_uidx on public.conversations(company_id, id);
create unique index if not exists messages_company_id_id_uidx on public.messages(company_id, id);
create unique index if not exists assistant_jobs_company_id_id_uidx on public.assistant_jobs(company_id, id);

create table if not exists public.intelligence_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  source_type text not null,
  source_id text not null,
  conversation_id uuid,
  actor_type text not null,
  actor_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  correlation_id text not null,
  causation_id uuid,
  depth integer not null default 0 check (depth >= 0 and depth <= 20),
  max_depth integer not null default 3 check (max_depth >= 0 and max_depth <= 20),
  idempotency_key text not null,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED','RATE_LIMITED')),
  processed_at timestamptz,
  safe_error_code text,
  check (length(event_type) between 1 and 80),
  check (length(source_type) between 1 and 80),
  check (length(source_id) between 1 and 500),
  check (length(actor_type) between 1 and 80),
  check (actor_id is null or length(actor_id) <= 500),
  check (length(correlation_id) between 1 and 120),
  check (length(idempotency_key) between 1 and 500),
  unique(company_id, id),
  unique(company_id, idempotency_key),
  constraint intelligence_events_company_conversation_fk foreign key (company_id, conversation_id)
    references public.conversations(company_id, id) on delete cascade,
  constraint intelligence_events_causation_fk foreign key (company_id, causation_id)
    references public.intelligence_events(company_id, id)
);

create unique index if not exists intelligence_events_company_id_id_uidx on public.intelligence_events(company_id, id);
create index if not exists intelligence_events_company_status_idx on public.intelligence_events(company_id, status, created_at);
create index if not exists intelligence_events_correlation_idx on public.intelligence_events(company_id, correlation_id, depth);

alter table public.assistant_jobs
  add column if not exists intelligence_event_id uuid,
  add column if not exists specialist_key text,
  add column if not exists tools_used text[] not null default '{}',
  add column if not exists research jsonb not null default '{}'::jsonb check (jsonb_typeof(research) = 'object'),
  add column if not exists confidence text,
  add column if not exists estimated_cost numeric(12,6) check (estimated_cost is null or estimated_cost >= 0),
  add column if not exists latency_ms integer check (latency_ms is null or latency_ms >= 0),
  add column if not exists approval_required boolean not null default false;

alter table public.ai_runs drop constraint if exists ai_runs_mode_check;
alter table public.ai_runs add constraint ai_runs_mode_check
  check (mode in ('assisted','automatic','supervised_autonomous'));

alter table public.assistant_jobs drop constraint if exists assistant_jobs_status_check;
alter table public.assistant_jobs add constraint assistant_jobs_status_check
  check (status in ('queued','processing','researching','waiting_input','waiting_approval','completed','failed','handed_off','cancelled'));
create unique index if not exists assistant_jobs_company_event_uidx
  on public.assistant_jobs(company_id, intelligence_event_id) where intelligence_event_id is not null;
alter table public.assistant_jobs drop constraint if exists assistant_jobs_company_event_fk;
alter table public.assistant_jobs add constraint assistant_jobs_company_event_fk
  foreign key (company_id, intelligence_event_id) references public.intelligence_events(company_id, id) on delete cascade;
alter table public.assistant_jobs drop constraint if exists assistant_jobs_company_conversation_fk;
alter table public.assistant_jobs add constraint assistant_jobs_company_conversation_fk
  foreign key (company_id, conversation_id) references public.conversations(company_id, id) on delete cascade not valid;
alter table public.assistant_jobs drop constraint if exists assistant_jobs_company_message_fk;
alter table public.assistant_jobs add constraint assistant_jobs_company_message_fk
  foreign key (company_id, message_id) references public.messages(company_id, id) on delete cascade not valid;

create table if not exists public.action_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null,
  event_id uuid not null,
  conversation_id uuid,
  action_type text not null,
  risk_level text not null check (risk_level in ('READ_ONLY','LOW_RISK','MEDIUM_RISK','HIGH_RISK','CRITICAL')),
  title text not null,
  description text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536),
  confidence text not null check (confidence in ('CONFIRMED','HIGH','MEDIUM','LOW','INSUFFICIENT')),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  status text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL','APPROVED','REJECTED','EXPIRED','CANCELLED','EXECUTED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  executed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (length(action_type) between 1 and 80),
  check (length(title) between 1 and 200),
  check (description is null or length(description) <= 4000),
  check (rejection_reason is null or length(rejection_reason) <= 500),
  constraint action_proposals_company_job_fk foreign key (company_id, job_id)
    references public.assistant_jobs(company_id, id) on delete cascade,
  constraint action_proposals_company_event_fk foreign key (company_id, event_id)
    references public.intelligence_events(company_id, id) on delete cascade,
  constraint action_proposals_company_conversation_fk foreign key (company_id, conversation_id)
    references public.conversations(company_id, id) on delete cascade,
  unique(company_id, job_id, action_type)
);

create index if not exists action_proposals_company_status_idx on public.action_proposals(company_id, status, created_at desc);
create index if not exists action_proposals_conversation_idx on public.action_proposals(company_id, conversation_id, status, created_at desc);
create unique index if not exists action_proposals_company_id_id_uidx on public.action_proposals(company_id, id);
drop trigger if exists action_proposals_set_updated_at on public.action_proposals;
create trigger action_proposals_set_updated_at before update on public.action_proposals
for each row execute function public.set_updated_at();

create table if not exists public.intelligence_memory (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('COMPANY','GLOBAL')),
  company_id uuid references public.companies(id) on delete cascade,
  memory_type text not null check (memory_type in ('EPISODIC','SEMANTIC','PROCEDURAL')),
  subject text not null,
  predicate text not null,
  value jsonb not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  source_type text not null,
  source_reference text,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  valid_from timestamptz,
  valid_until timestamptz,
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE','VALIDATED','REJECTED','STALE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'COMPANY' and company_id is not null) or (scope = 'GLOBAL' and company_id is null)),
  check (scope <> 'GLOBAL' or source_type in ('CURATED_PROFESSIONAL','PUBLIC_VERIFIED')),
  check (length(subject) between 1 and 240),
  check (length(predicate) between 1 and 160),
  check (source_reference is null or length(source_reference) <= 1000),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index if not exists intelligence_memory_company_lookup_idx
  on public.intelligence_memory(company_id, memory_type, subject, status, updated_at desc);
drop trigger if exists intelligence_memory_set_updated_at on public.intelligence_memory;
create trigger intelligence_memory_set_updated_at before update on public.intelligence_memory
for each row execute function public.set_updated_at();

alter table public.assistant_feedback drop constraint if exists assistant_feedback_feedback_type_check;
alter table public.assistant_feedback add constraint assistant_feedback_feedback_type_check
  check (feedback_type in (
    'accepted','edited','rejected','part_confirmed','part_corrected','application_confirmed',
    'APPROVED_AS_IS','APPROVED_WITH_EDIT','REJECTED_WRONG_FACT','REJECTED_WRONG_APPLICATION',
    'REJECTED_WRONG_TONE','REJECTED_INSUFFICIENT_EVIDENCE','REJECTED_OTHER'
  ));
alter table public.assistant_feedback add column if not exists proposal_id uuid;
alter table public.assistant_feedback drop constraint if exists assistant_feedback_company_proposal_fk;
alter table public.assistant_feedback add constraint assistant_feedback_company_proposal_fk
  foreign key (company_id, proposal_id) references public.action_proposals(company_id, id);

create unique index if not exists ai_runs_company_id_id_uidx on public.ai_runs(company_id, id);
alter table public.ai_runs add column if not exists intelligence_event_id uuid;
alter table public.ai_runs add column if not exists action_proposal_id uuid;
alter table public.ai_runs drop constraint if exists ai_runs_company_event_fk;
alter table public.ai_runs add constraint ai_runs_company_event_fk
  foreign key (company_id, intelligence_event_id) references public.intelligence_events(company_id, id);
alter table public.ai_runs drop constraint if exists ai_runs_company_proposal_fk;
alter table public.ai_runs add constraint ai_runs_company_proposal_fk
  foreign key (company_id, action_proposal_id) references public.action_proposals(company_id, id);

alter table public.intelligence_events enable row level security;
alter table public.action_proposals enable row level security;
alter table public.intelligence_memory enable row level security;
revoke all on public.intelligence_events, public.action_proposals, public.intelligence_memory from anon, authenticated;
grant select on public.intelligence_events, public.action_proposals, public.intelligence_memory to authenticated;
grant select, insert, update on public.intelligence_events, public.action_proposals, public.intelligence_memory to service_role;

drop policy if exists intelligence_events_select on public.intelligence_events;
create policy intelligence_events_select on public.intelligence_events for select to authenticated
using (public.current_company_role(company_id) in ('admin','gestor'));

drop policy if exists action_proposals_select on public.action_proposals;
create policy action_proposals_select on public.action_proposals for select to authenticated
using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'));

drop policy if exists intelligence_memory_select on public.intelligence_memory;
create policy intelligence_memory_select on public.intelligence_memory for select to authenticated
using (scope = 'GLOBAL' or public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'));

create or replace function public.enqueue_intelligence_event(
  target_company uuid,
  target_event_type text,
  target_source_type text,
  target_source_id text,
  target_conversation uuid,
  target_message uuid,
  target_actor_type text,
  target_actor_id text,
  target_payload jsonb,
  target_occurred_at timestamptz,
  target_correlation_id text,
  target_causation_id uuid,
  target_depth integer,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.company_assistant_settings;
  event_row public.intelligence_events;
  job_row public.assistant_jobs;
  day_count integer;
  hour_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if target_event_type <> 'CUSTOMER_MESSAGE_RECEIVED' then raise exception 'UNSUPPORTED_INTELLIGENCE_EVENT'; end if;
  if target_conversation is null or target_message is null then raise exception 'INVALID_EVENT_SCOPE'; end if;
  if not exists (
    select 1 from public.messages m
    where m.company_id = target_company and m.id = target_message
      and m.conversation_id = target_conversation and m.sender_type = 'customer'
  ) then raise exception 'INVALID_EVENT_SCOPE'; end if;
  if target_depth < 0 then raise exception 'INVALID_EVENT_DEPTH'; end if;
  if target_idempotency_key is null or length(target_idempotency_key) not between 1 and 500 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;

  select * into cfg from public.company_assistant_settings where company_id = target_company;
  if cfg.company_id is null or cfg.autonomy_mode <> 'SUPERVISED_AUTONOMOUS' then
    return jsonb_build_object('status','IGNORED','reason','AUTONOMY_NOT_ENABLED');
  end if;
  if target_depth > cfg.max_event_depth then
    return jsonb_build_object('status','BLOCKED','reason','MAX_DEPTH_REACHED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':' || target_idempotency_key, 0));
  select * into event_row from public.intelligence_events
  where company_id = target_company and idempotency_key = target_idempotency_key;
  if event_row.id is not null then
    select * into job_row from public.assistant_jobs
    where company_id = target_company and intelligence_event_id = event_row.id;
    return jsonb_build_object('status','DEDUPLICATED','event_id',event_row.id,'job_id',job_row.id,'job_status',job_row.status);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':intelligence-budget', 0));
  select count(*) into day_count from public.intelligence_events
  where company_id = target_company and created_at >= date_trunc('day', now());
  select count(*) into hour_count from public.intelligence_events
  where company_id = target_company and created_at >= date_trunc('hour', now());
  if day_count >= cfg.max_autonomous_jobs_per_day or hour_count >= cfg.max_autonomous_jobs_per_hour then
    return jsonb_build_object('status','RATE_LIMITED','reason','AUTONOMOUS_JOB_BUDGET_EXCEEDED');
  end if;

  insert into public.intelligence_events(
    company_id,event_type,source_type,source_id,conversation_id,actor_type,actor_id,payload,
    occurred_at,correlation_id,causation_id,depth,max_depth,idempotency_key,status
  ) values (
    target_company,target_event_type,target_source_type,target_source_id,target_conversation,target_actor_type,
    left(target_actor_id,500),coalesce(target_payload,'{}'::jsonb),coalesce(target_occurred_at,now()),
    left(coalesce(target_correlation_id,gen_random_uuid()::text),120),target_causation_id,target_depth,
    cfg.max_event_depth,target_idempotency_key,'PENDING'
  ) returning * into event_row;

  insert into public.assistant_jobs(
    company_id,conversation_id,message_id,provider_message_id,status,intelligence_event_id,approval_required
  ) values (
    target_company,target_conversation,target_message,'intelligence:' || event_row.id::text,'queued',event_row.id,true
  ) returning * into job_row;

  return jsonb_build_object('status','QUEUED','event_id',event_row.id,'job_id',job_row.id,'job_status',job_row.status);
end;
$$;

create or replace function public.create_action_proposal(
  target_company uuid,
  target_job uuid,
  target_event uuid,
  target_conversation uuid,
  target_action_type text,
  target_risk_level text,
  target_title text,
  target_description text,
  target_payload jsonb,
  target_confidence text,
  target_evidence jsonb,
  target_expires_at timestamptz default null
)
returns public.action_proposals
language plpgsql
security definer
set search_path = public
as $$
declare result public.action_proposals;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if target_risk_level = 'CRITICAL' then raise exception 'CRITICAL_ACTION_BLOCKED'; end if;
  if target_risk_level not in ('READ_ONLY','LOW_RISK','MEDIUM_RISK','HIGH_RISK') then raise exception 'INVALID_RISK_LEVEL'; end if;
  if not exists (
    select 1 from public.assistant_jobs j
    where j.id = target_job and j.company_id = target_company and j.intelligence_event_id = target_event
      and (target_conversation is null or j.conversation_id = target_conversation)
  ) then raise exception 'INVALID_PROPOSAL_SCOPE'; end if;
  if jsonb_typeof(coalesce(target_payload,'{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(target_evidence,'[]'::jsonb)) <> 'array' then raise exception 'INVALID_PROPOSAL_PAYLOAD'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_job::text || ':' || target_action_type, 0));
  insert into public.action_proposals(
    company_id,job_id,event_id,conversation_id,action_type,risk_level,title,description,payload,
    confidence,evidence,status,expires_at
  ) values (
    target_company,target_job,target_event,target_conversation,left(target_action_type,80),target_risk_level,
    left(target_title,200),left(target_description,4000),coalesce(target_payload,'{}'::jsonb),target_confidence,
    coalesce(target_evidence,'[]'::jsonb),'PENDING_APPROVAL',target_expires_at
  ) on conflict (company_id,job_id,action_type) do update set
    title = excluded.title,
    description = excluded.description,
    payload = excluded.payload,
    confidence = excluded.confidence,
    evidence = excluded.evidence,
    expires_at = excluded.expires_at
  where public.action_proposals.status = 'PENDING_APPROVAL'
  returning * into result;

  if result.id is null then
    select * into result from public.action_proposals
    where company_id = target_company and job_id = target_job and action_type = target_action_type;
  end if;
  update public.assistant_jobs set status='waiting_approval', approval_required=true,
    confidence=target_confidence, finished_at=null where id=target_job and company_id=target_company;
  update public.intelligence_events set status='COMPLETED', processed_at=now()
    where id=target_event and company_id=target_company;
  if target_conversation is not null then
    update public.conversations set status='waiting_human'
    where id=target_conversation and company_id=target_company;
  end if;
  return result;
end;
$$;

create or replace function public.review_intelligence_proposal(
  target_company uuid,
  target_proposal uuid,
  target_decision text,
  target_payload jsonb default null,
  target_rejection_reason text default null,
  target_feedback_type text default null
)
returns public.action_proposals
language plpgsql
security definer
set search_path = public
as $$
declare proposal public.action_proposals;
declare feedback_kind text;
begin
  if auth.uid() is null or public.current_company_role(target_company) not in ('admin','gestor','comercial','vendedor','atendimento') then
    raise exception 'FORBIDDEN';
  end if;
  if target_decision not in ('APPROVE','EDIT','REJECT') then raise exception 'INVALID_PROPOSAL_DECISION'; end if;
  if target_decision = 'EDIT' and jsonb_typeof(coalesce(target_payload,'null'::jsonb)) <> 'object' then raise exception 'INVALID_EDIT_PAYLOAD'; end if;
  if target_decision = 'REJECT' and length(trim(coalesce(target_rejection_reason,''))) < 2 then raise exception 'REJECTION_REASON_REQUIRED'; end if;

  select * into proposal from public.action_proposals
  where id=target_proposal and company_id=target_company for update;
  if proposal.id is null or proposal.status <> 'PENDING_APPROVAL' or (proposal.expires_at is not null and proposal.expires_at <= now()) then
    raise exception 'PROPOSAL_NOT_AVAILABLE';
  end if;

  if target_decision in ('APPROVE','EDIT') then
    update public.action_proposals set
      status='APPROVED', payload=case when target_decision='EDIT' then target_payload else payload end,
      approved_by=auth.uid(), approved_at=now()
    where id=proposal.id returning * into proposal;
    feedback_kind := case when target_decision='EDIT' then 'APPROVED_WITH_EDIT' else 'APPROVED_AS_IS' end;
  else
    feedback_kind := case
      when target_feedback_type in ('REJECTED_WRONG_FACT','REJECTED_WRONG_APPLICATION','REJECTED_WRONG_TONE','REJECTED_INSUFFICIENT_EVIDENCE') then target_feedback_type
      else 'REJECTED_OTHER' end;
    update public.action_proposals set status='REJECTED', rejected_by=auth.uid(), rejected_at=now(),
      rejection_reason=left(trim(target_rejection_reason),500)
    where id=proposal.id returning * into proposal;
  end if;

  insert into public.assistant_feedback(
    company_id,conversation_id,trace_id,feedback_type,original_suggestion,final_response,
    structured_feedback,created_by,proposal_id
  ) select proposal.company_id,proposal.conversation_id,j.trace_id,feedback_kind,
    left(proposal.description,4000),
    case when target_decision in ('APPROVE','EDIT') then left(proposal.payload->>'proposed_text',4000) else null end,
    jsonb_build_object('decision',target_decision,'risk_level',proposal.risk_level,'action_type',proposal.action_type,
      'rejection_reason',target_rejection_reason),auth.uid(),proposal.id
  from public.assistant_jobs j where j.id=proposal.job_id;

  update public.assistant_jobs set status='completed', processed_at=now(), finished_at=now()
  where id=proposal.job_id and company_id=target_company and status='waiting_approval';
  if proposal.conversation_id is not null then
    update public.conversations set status='in_progress'
    where id=proposal.conversation_id and company_id=target_company;
  end if;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,new_data)
  values (target_company,auth.uid(),'intelligence.proposal.' || lower(target_decision),'ActionProposal',proposal.id,
    jsonb_build_object('status',proposal.status,'action_type',proposal.action_type,'risk_level',proposal.risk_level));
  return proposal;
end;
$$;

create or replace function public.create_company_memory_candidate(
  target_company uuid,
  target_memory_type text,
  target_subject text,
  target_predicate text,
  target_value jsonb,
  target_confidence numeric,
  target_source_type text,
  target_source_reference text,
  target_evidence jsonb
)
returns public.intelligence_memory
language plpgsql
security definer
set search_path = public
as $$
declare result public.intelligence_memory;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  if target_memory_type not in ('EPISODIC','SEMANTIC','PROCEDURAL') then raise exception 'INVALID_MEMORY_TYPE'; end if;
  if target_confidence < 0 or target_confidence > 1 then raise exception 'INVALID_MEMORY_CONFIDENCE'; end if;
  insert into public.intelligence_memory(
    scope,company_id,memory_type,subject,predicate,value,confidence,source_type,source_reference,evidence,status
  ) values (
    'COMPANY',target_company,target_memory_type,left(target_subject,240),left(target_predicate,160),target_value,
    target_confidence,left(target_source_type,80),left(target_source_reference,1000),coalesce(target_evidence,'[]'::jsonb),'CANDIDATE'
  ) returning * into result;
  return result;
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
  if target_status not in ('queued','researching','waiting_input','waiting_approval','completed','failed','handed_off','cancelled') then raise exception 'INVALID_ASSISTANT_JOB_STATUS'; end if;
  update public.assistant_jobs set
    status=target_status,response_message_id=target_response_message,
    error_code=case when target_error_code is null then null else left(target_error_code,80) end,
    error_stage=case when target_error_stage is null then null else left(target_error_stage,80) end,
    processed_at=case when target_status in ('completed','failed','handed_off','cancelled') then now() else processed_at end,
    finished_at=case when target_status in ('completed','failed','handed_off','cancelled') then now() else null end,
    next_attempt_at=case when target_status='queued' then now()+interval '30 seconds' else next_attempt_at end
  where id=target_job and status='processing';
  return found;
end;
$$;

revoke all on function public.enqueue_intelligence_event(uuid,text,text,text,uuid,uuid,text,text,jsonb,timestamptz,text,uuid,integer,text) from public, anon, authenticated;
revoke all on function public.create_action_proposal(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.review_intelligence_proposal(uuid,uuid,text,jsonb,text,text) from public, anon;
revoke all on function public.create_company_memory_candidate(uuid,text,text,text,jsonb,numeric,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.finish_assistant_job(uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.enqueue_intelligence_event(uuid,text,text,text,uuid,uuid,text,text,jsonb,timestamptz,text,uuid,integer,text) to service_role;
grant execute on function public.create_action_proposal(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb,timestamptz) to service_role;
grant execute on function public.review_intelligence_proposal(uuid,uuid,text,jsonb,text,text) to authenticated;
grant execute on function public.create_company_memory_candidate(uuid,text,text,text,jsonb,numeric,text,text,jsonb) to service_role;
grant execute on function public.finish_assistant_job(uuid,text,uuid,text,text) to service_role;

comment on column public.company_assistant_settings.autonomy_mode is
  'OFF, ASSISTED or SUPERVISED_AUTONOMOUS. Unsupervised AUTONOMOUS is intentionally unavailable in Level 1.';
comment on table public.intelligence_events is
  'Idempotent company-scoped events. Payloads are private tenant data and must never be globalized.';
comment on table public.action_proposals is
  'Human-review proposals only. APPROVED does not mean externally executed.';
comment on table public.intelligence_memory is
  'Validated memory lifecycle. Private company sources can only use COMPANY scope (NEVER_GLOBALIZE).';

-- Conceptual rollback: set autonomy_mode=OFF, undeploy the Level 1 workers/UI,
-- preserve events/proposals/memory for audit, then remove only 0049 objects.
