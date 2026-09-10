-- Company-scoped AI traces, budgets and platform health. Apply manually after 0045.
alter table public.company_assistant_settings
  add column if not exists max_daily_ai_calls integer not null default 100 check (max_daily_ai_calls between 0 and 100000),
  add column if not exists max_daily_web_queries integer not null default 300 check (max_daily_web_queries between 0 and 1000000),
  add column if not exists max_research_rounds integer not null default 2 check (max_research_rounds between 1 and 10),
  add column if not exists max_tokens_per_request integer not null default 8000 check (max_tokens_per_request between 256 and 1000000),
  add column if not exists max_daily_ai_cost numeric(12,4) not null default 0 check (max_daily_ai_cost >= 0),
  add column if not exists estimated_cost_per_1k_tokens numeric(12,6) not null default 0 check (estimated_cost_per_1k_tokens >= 0);

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  trace_id text not null, conversation_id uuid references public.conversations(id) on delete set null,
  assistant_job_id uuid references public.assistant_jobs(id) on delete set null,
  mode text not null default 'assisted' check (mode in ('assisted','automatic')),
  status text not null default 'running' check (status in ('running','completed','failed','handed_off')),
  current_stage text not null, provider text, model text, tool_names text[] not null default '{}',
  query_count integer not null default 0 check (query_count >= 0), source_domains text[] not null default '{}',
  candidate_count integer not null default 0 check (candidate_count >= 0), confidence text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0), output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost numeric(12,6) check (estimated_cost is null or estimated_cost >= 0), duration_ms integer check (duration_ms is null or duration_ms >= 0),
  safe_error_code text, started_at timestamptz not null default now(), finished_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id, trace_id), check (length(trace_id) between 1 and 120)
);
create table if not exists public.ai_run_events (
  id bigint generated always as identity primary key, company_id uuid not null references public.companies(id) on delete cascade,
  trace_id text not null, stage text not null, status text not null default 'success' check (status in ('success','error','skipped')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0), counts jsonb not null default '{}'::jsonb,
  safe_error_code text, created_at timestamptz not null default now(), check (length(trace_id) between 1 and 120)
);
create table if not exists public.integration_health_snapshots (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  service text not null, state text not null check (state in ('HEALTHY','DEGRADED','ERROR','UNKNOWN')),
  reason_code text, evidence_at timestamptz, checked_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb,
  unique(company_id, service)
);
create index if not exists ai_runs_company_started_idx on public.ai_runs(company_id, started_at desc);
create index if not exists ai_run_events_trace_idx on public.ai_run_events(company_id, trace_id, created_at);
create index if not exists integration_health_company_idx on public.integration_health_snapshots(company_id, checked_at desc);
drop trigger if exists ai_runs_set_updated_at on public.ai_runs;
create trigger ai_runs_set_updated_at before update on public.ai_runs for each row execute function public.set_updated_at();

alter table public.ai_runs enable row level security;
alter table public.ai_run_events enable row level security;
alter table public.integration_health_snapshots enable row level security;
create policy ai_runs_select on public.ai_runs for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor'));
create policy ai_run_events_select on public.ai_run_events for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor'));
create policy integration_health_select on public.integration_health_snapshots for select to authenticated using (public.current_company_role(company_id) in ('admin','gestor'));
revoke all on public.ai_runs, public.ai_run_events, public.integration_health_snapshots from anon, authenticated;
grant select on public.ai_runs, public.ai_run_events, public.integration_health_snapshots to authenticated;
grant select, insert, update on public.ai_runs, public.integration_health_snapshots to service_role;
grant select, insert on public.ai_run_events to service_role;

create or replace function public.reserve_ai_budget(target_company uuid, requested_ai_calls integer default 0, requested_web_queries integer default 0, requested_tokens integer default 0, requested_cost numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg public.company_assistant_settings; day date := current_date; used_ai integer := 0; used_web integer := 0; used_tokens integer := 0; used_cost_units integer := 0; requested_cost_units integer := greatest(0, floor(coalesce(requested_cost,0) * 1000000));
begin
  if requested_ai_calls < 0 or requested_web_queries < 0 or requested_tokens < 0 or requested_cost < 0 then raise exception 'INVALID_AI_BUDGET_REQUEST'; end if;
  select * into cfg from public.company_assistant_settings where company_id = target_company;
  if cfg.company_id is null then return jsonb_build_object('allowed',false,'reason','settings_not_found'); end if;
  perform pg_advisory_xact_lock(hashtext(target_company::text || day::text));
  select coalesce(max(count) filter (where metric='ai_calls'),0), coalesce(max(count) filter (where metric='web_queries'),0), coalesce(max(count) filter (where metric='ai_tokens'),0), coalesce(max(count) filter (where metric='ai_cost_microunits'),0)
    into used_ai,used_web,used_tokens,used_cost_units from public.usage_counters where company_id=target_company and period=day;
  if used_ai + requested_ai_calls > cfg.max_daily_ai_calls then return jsonb_build_object('allowed',false,'reason','daily_ai_calls_exceeded'); end if;
  if used_web + requested_web_queries > cfg.max_daily_web_queries then return jsonb_build_object('allowed',false,'reason','daily_web_queries_exceeded'); end if;
  if requested_tokens > cfg.max_tokens_per_request then return jsonb_build_object('allowed',false,'reason','request_tokens_exceeded'); end if;
  if cfg.max_daily_ai_cost > 0 and used_cost_units + requested_cost_units > floor(cfg.max_daily_ai_cost * 1000000) then return jsonb_build_object('allowed',false,'reason','daily_ai_cost_exceeded'); end if;
  insert into public.usage_counters(company_id,metric,period,count) values
    (target_company,'ai_calls',day,requested_ai_calls),(target_company,'web_queries',day,requested_web_queries),(target_company,'ai_tokens',day,requested_tokens),(target_company,'ai_cost_microunits',day,requested_cost_units)
  on conflict(company_id,metric,period) do update set count=public.usage_counters.count+excluded.count;
  return jsonb_build_object('allowed',true,'reason','budget_reserved');
end; $$;
revoke all on function public.reserve_ai_budget(uuid,integer,integer,integer,numeric) from public, anon, authenticated;
grant execute on function public.reserve_ai_budget(uuid,integer,integer,integer,numeric) to service_role;

-- Conceptual rollback: disable AI execution, export trace summaries, remove the RPC,
-- policies/tables and the six settings columns. usage_counters remain valid audit data.
