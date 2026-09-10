-- Unified company knowledge and immutable assistant feedback. Apply manually after 0043.
create table if not exists public.company_knowledge (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  knowledge_type text not null check (knowledge_type in ('verified_fact','resolved_case','customer_preference','supplier_knowledge','product_knowledge')),
  subject_key text not null default 'company',
  fact_key text not null,
  fact_value jsonb not null,
  source_type text not null check (source_type in ('human_feedback','internal_record','official_source','resolved_case','imported')),
  source_ref text,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
  status text not null default 'active' check (status in ('active','superseded','rejected')),
  trace_id text,
  verified_at timestamptz not null,
  verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(subject_key) between 1 and 160),
  check (length(fact_key) between 1 and 160),
  check (source_ref is null or length(source_ref) <= 500),
  check (trace_id is null or length(trace_id) <= 120)
);
create unique index if not exists company_knowledge_active_fact_uidx
  on public.company_knowledge(company_id, knowledge_type, subject_key, fact_key)
  where status = 'active';
create index if not exists company_knowledge_lookup_idx
  on public.company_knowledge(company_id, knowledge_type, subject_key, verified_at desc);

create table if not exists public.assistant_feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  trace_id text,
  feedback_type text not null check (feedback_type in ('accepted','edited','rejected','part_confirmed','part_corrected','application_confirmed')),
  original_suggestion text,
  final_response text,
  structured_feedback jsonb not null default '{}'::jsonb check (jsonb_typeof(structured_feedback) = 'object'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  check (trace_id is null or length(trace_id) <= 120),
  check (original_suggestion is null or length(original_suggestion) <= 4000),
  check (final_response is null or length(final_response) <= 4000)
);
create index if not exists assistant_feedback_trace_idx on public.assistant_feedback(company_id, trace_id, created_at desc);
create index if not exists assistant_feedback_conversation_idx on public.assistant_feedback(company_id, conversation_id, created_at desc);

drop trigger if exists company_knowledge_set_updated_at on public.company_knowledge;
create trigger company_knowledge_set_updated_at before update on public.company_knowledge
for each row execute function public.set_updated_at();

alter table public.company_knowledge enable row level security;
alter table public.assistant_feedback enable row level security;
revoke all on table public.company_knowledge, public.assistant_feedback from anon;
grant select, insert, update on table public.company_knowledge to authenticated;
grant select, insert on table public.assistant_feedback to authenticated;
grant select, insert, update on table public.company_knowledge to service_role;
grant select, insert on table public.assistant_feedback to service_role;

drop policy if exists company_knowledge_select on public.company_knowledge;
drop policy if exists company_knowledge_manage on public.company_knowledge;
create policy company_knowledge_select on public.company_knowledge for select to authenticated
using (public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento'));
create policy company_knowledge_manage on public.company_knowledge for all to authenticated
using (public.current_company_role(company_id) in ('admin','gestor'))
with check (public.current_company_role(company_id) in ('admin','gestor'));

drop policy if exists assistant_feedback_select on public.assistant_feedback;
drop policy if exists assistant_feedback_insert on public.assistant_feedback;
create policy assistant_feedback_select on public.assistant_feedback for select to authenticated
using (public.current_company_role(company_id) in ('admin','gestor'));
create policy assistant_feedback_insert on public.assistant_feedback for insert to authenticated
with check (
  created_by = auth.uid()
  and public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor','atendimento')
  and exists (select 1 from public.conversations c where c.id = conversation_id and c.company_id = company_id)
);

create or replace function public.promote_assistant_feedback_to_knowledge(
  target_company uuid,
  target_feedback uuid,
  target_knowledge_type text,
  target_subject_key text,
  target_fact_key text,
  target_fact_value jsonb,
  target_confidence numeric default 1
)
returns public.company_knowledge
language plpgsql
security definer
set search_path = public
as $$
declare feedback public.assistant_feedback;
declare result public.company_knowledge;
begin
  if auth.uid() is null or public.current_company_role(target_company) not in ('admin','gestor') then raise exception 'FORBIDDEN'; end if;
  select * into feedback from public.assistant_feedback where id = target_feedback and company_id = target_company;
  if feedback.id is null or feedback.feedback_type not in ('part_confirmed','part_corrected','application_confirmed') then raise exception 'FEEDBACK_NOT_VERIFIABLE'; end if;
  if target_knowledge_type not in ('verified_fact','resolved_case','customer_preference','supplier_knowledge','product_knowledge') then raise exception 'INVALID_KNOWLEDGE_TYPE'; end if;
  if target_subject_key is null or length(target_subject_key) not between 1 and 160 or target_fact_key is null or length(target_fact_key) not between 1 and 160 then raise exception 'INVALID_KNOWLEDGE_KEY'; end if;
  if target_confidence < 0 or target_confidence > 1 then raise exception 'INVALID_CONFIDENCE'; end if;

  update public.company_knowledge set status = 'superseded'
  where company_id = target_company and knowledge_type = target_knowledge_type
    and subject_key = target_subject_key and fact_key = target_fact_key and status = 'active';

  insert into public.company_knowledge(
    company_id, knowledge_type, subject_key, fact_key, fact_value, source_type,
    source_ref, confidence, scope, trace_id, verified_at, verified_by
  ) values (
    target_company, target_knowledge_type, target_subject_key, target_fact_key, target_fact_value,
    'human_feedback', feedback.id::text, target_confidence,
    jsonb_build_object('conversation_id', feedback.conversation_id),
    feedback.trace_id, now(), auth.uid()
  ) returning * into result;
  return result;
end;
$$;

revoke all on function public.promote_assistant_feedback_to_knowledge(uuid,uuid,text,text,text,jsonb,numeric) from public, anon;
grant execute on function public.promote_assistant_feedback_to_knowledge(uuid,uuid,text,text,text,jsonb,numeric) to authenticated;

