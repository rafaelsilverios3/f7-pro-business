-- Durable claim/lease and sanitized per-attempt audit for Mercado Livre events.
-- This migration does not call the provider or modify commercial records.

alter table public.meli_webhook_events
  add column claim_token uuid,
  add column claimed_at timestamptz,
  add column lease_expires_at timestamptz;

-- The event ID is globally unique, but the attempt ledger deliberately carries
-- company_id as a tenant boundary. Add the matching composite key so the FK
-- below can enforce that an attempt cannot be attached to another company's
-- event.
alter table public.meli_webhook_events
  add constraint meli_webhook_events_company_id_id_key unique (company_id, id);

create index meli_webhook_claimable_idx
  on public.meli_webhook_events(status, next_attempt_at, received_at)
  where status in ('pending','retry','processing');

create table public.meli_webhook_event_attempts (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  event_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 6),
  claim_token uuid not null,
  status text not null check (status in ('processing','processed','retry','dead_letter')),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{1,80}$'),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique (company_id, event_id, attempt_number),
  foreign key (company_id, event_id)
    references public.meli_webhook_events(company_id, id) on delete cascade
);

alter table public.meli_webhook_event_attempts enable row level security;
revoke all on public.meli_webhook_event_attempts from public, anon, authenticated;
grant select, insert, update on public.meli_webhook_event_attempts to service_role;
grant usage, select on sequence public.meli_webhook_event_attempts_id_seq to service_role;

create or replace function public.meli_claim_notification_batch(
  p_claim_token uuid,
  p_limit integer default 10,
  p_company_id uuid default null,
  p_connection_id uuid default null
)
returns table(id uuid, company_id uuid, connection_id uuid, topic text, resource_path text, attempts integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_claim_token is null or p_limit is null or p_limit < 1 or p_limit > 20
     or ((p_company_id is null) <> (p_connection_id is null)) then
    raise exception 'invalid claim parameters' using errcode = '22023';
  end if;

  -- Expired leases and claims made by the old worker are recoverable. Exhausted
  -- rows go to dead-letter before any further attempt can be claimed.
  with exhausted as (
    update public.meli_webhook_events event
       set status = 'dead_letter', last_error_code = 'MELI_RETRIES_EXHAUSTED',
           claim_token = null, claimed_at = null, lease_expires_at = null
     where event.attempts >= 6
       and (event.status in ('pending','retry')
         or (event.status = 'processing' and coalesce(event.lease_expires_at, event.received_at + interval '10 minutes') <= clock_timestamp()))
       and (p_company_id is null or event.company_id = p_company_id)
       and (p_connection_id is null or event.connection_id = p_connection_id)
     returning event.company_id, event.id, event.attempts
  )
  update public.meli_webhook_event_attempts attempt
     set status = 'dead_letter', error_code = 'MELI_RETRIES_EXHAUSTED', finished_at = clock_timestamp()
    from exhausted
   where attempt.company_id = exhausted.company_id
     and attempt.event_id = exhausted.id
     and attempt.attempt_number = exhausted.attempts
     and attempt.status = 'processing';

  return query
    with candidates as (
      select event.id, event.company_id
        from public.meli_webhook_events event
       where ((event.status in ('pending','retry') and event.next_attempt_at <= clock_timestamp())
          or (event.status = 'processing' and
             coalesce(event.lease_expires_at, event.received_at + interval '10 minutes') <= clock_timestamp()))
         and event.attempts < 6
         and (p_company_id is null or event.company_id = p_company_id)
         and (p_connection_id is null or event.connection_id = p_connection_id)
       order by event.received_at, event.id
       for update skip locked
       limit p_limit
    ), claimed as (
      update public.meli_webhook_events event
         set status = 'processing', attempts = event.attempts + 1,
             claim_token = p_claim_token, claimed_at = clock_timestamp(),
             lease_expires_at = clock_timestamp() + interval '5 minutes'
        from candidates
       where event.id = candidates.id and event.company_id = candidates.company_id
      returning event.id, event.company_id, event.connection_id, event.topic,
                event.resource_path, event.attempts
    ), audited as (
      insert into public.meli_webhook_event_attempts(company_id, event_id, attempt_number, claim_token, status)
      select claimed.company_id, claimed.id, claimed.attempts, p_claim_token, 'processing'
        from claimed
      returning event_id
    )
    select claimed.id, claimed.company_id, claimed.connection_id, claimed.topic,
           claimed.resource_path, claimed.attempts
      from claimed join audited on audited.event_id = claimed.id;
end;
$$;

create or replace function public.meli_finish_notification_event(
  p_company_id uuid,
  p_event_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  event_attempt integer;
  final_outcome text;
  safe_code text;
  changed integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_company_id is null or p_event_id is null or p_claim_token is null or p_outcome is null
     or p_outcome not in ('processed','retry','dead_letter') then
    raise exception 'invalid settlement parameters' using errcode = '22023';
  end if;
  if p_outcome <> 'processed' and coalesce(p_error_code, '') !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'invalid error code' using errcode = '22023';
  end if;

  select event.attempts into event_attempt
    from public.meli_webhook_events event
   where event.company_id = p_company_id and event.id = p_event_id
     and event.status = 'processing' and event.claim_token = p_claim_token
   for update;
  if not found then return false; end if;

  final_outcome := case when event_attempt >= 6 and p_outcome = 'retry' then 'dead_letter' else p_outcome end;
  safe_code := case
    when final_outcome = 'processed' then null
    when event_attempt >= 6 and p_outcome = 'retry' then 'MELI_RETRIES_EXHAUSTED'
    else p_error_code
  end;

  update public.meli_webhook_events event
     set status = final_outcome,
         processed_at = case when final_outcome = 'processed' then clock_timestamp() else null end,
         last_error_code = safe_code,
         next_attempt_at = case when final_outcome = 'retry'
           then clock_timestamp() + least(interval '1 hour', interval '30 seconds' * power(2, event_attempt - 1))
           else event.next_attempt_at end,
         claim_token = null, claimed_at = null, lease_expires_at = null
   where event.company_id = p_company_id and event.id = p_event_id
     and event.status = 'processing' and event.claim_token = p_claim_token;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  update public.meli_webhook_event_attempts attempt
     set status = final_outcome, error_code = safe_code, finished_at = clock_timestamp()
   where attempt.company_id = p_company_id and attempt.event_id = p_event_id
     and attempt.attempt_number = event_attempt and attempt.claim_token = p_claim_token
     and attempt.status = 'processing';
  return true;
end;
$$;

revoke all on function public.meli_claim_notification_batch(uuid, integer, uuid, uuid) from public, anon, authenticated;
revoke all on function public.meli_finish_notification_event(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.meli_claim_notification_batch(uuid, integer, uuid, uuid) to service_role;
grant execute on function public.meli_finish_notification_event(uuid, uuid, uuid, text, text) to service_role;

comment on table public.meli_webhook_event_attempts is 'Sanitized attempt audit for Mercado Livre queue processing; provider payloads and credentials are never stored.';
comment on function public.meli_claim_notification_batch(uuid, integer, uuid, uuid) is 'Atomically claims due Mercado Livre events using SKIP LOCKED and a five-minute recoverable lease.';
comment on function public.meli_finish_notification_event(uuid, uuid, uuid, text, text) is 'Idempotent claim-token-scoped settlement with server-side retry backoff and dead-letter handling.';
