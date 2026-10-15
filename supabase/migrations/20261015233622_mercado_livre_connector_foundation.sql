-- Mercado Livre connector foundation. Tokens and OAuth state are server-only.
-- No products, stock, prices, sales, orders or financial records are changed.

create table if not exists public.meli_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  seller_id text not null,
  seller_nickname text,
  status text not null default 'connected'
    check (status in ('connected','disconnected','reauth_required','error')),
  scopes text[] not null default '{}',
  access_token_ciphertext text,
  access_token_iv text,
  access_token_expires_at timestamptz,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  token_version bigint not null default 1 check (token_version > 0),
  refresh_lease_id uuid,
  refresh_lease_until timestamptz,
  last_catalog_sync_at timestamptz,
  catalog_scroll_id text,
  last_orders_sync_at timestamptz,
  last_error_code text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, seller_id),
  unique (company_id, id),
  check ((status = 'connected' and access_token_ciphertext is not null and access_token_iv is not null
          and refresh_token_ciphertext is not null and refresh_token_iv is not null)
      or status <> 'connected')
);

create table if not exists public.meli_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  pkce_verifier_ciphertext text,
  pkce_verifier_iv text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.meli_listing_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null,
  product_id uuid,
  external_item_id text not null,
  title text not null,
  status text not null,
  permalink text,
  currency_id text,
  price numeric(14,2),
  available_quantity integer,
  category_id text,
  seller_sku text,
  external_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, connection_id, external_item_id),
  foreign key (company_id, connection_id) references public.meli_connections(company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products(company_id, id) on delete set null (product_id)
);

create table if not exists public.meli_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null,
  external_order_id text not null,
  status text not null,
  date_created timestamptz,
  date_closed timestamptz,
  currency_id text,
  total_amount numeric(14,2),
  paid_amount numeric(14,2),
  item_count integer not null default 0 check (item_count >= 0),
  shipping_status text,
  -- Deliberately excludes buyer identity, address, phone, e-mail and raw payload.
  source_summary jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, connection_id, external_order_id),
  foreign key (company_id, connection_id) references public.meli_connections(company_id, id) on delete cascade
);

create table if not exists public.meli_webhook_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null,
  dedupe_key text not null,
  topic text not null check (topic in ('items','orders_v2')),
  resource_path text not null check (resource_path ~ '^/[A-Za-z0-9_/-]{1,240}$'),
  status text not null default 'pending'
    check (status in ('pending','processing','processed','retry','dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  unique (company_id, dedupe_key),
  foreign key (company_id, connection_id) references public.meli_connections(company_id, id) on delete cascade
);

create table if not exists public.meli_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null,
  operation text not null check (operation in ('catalog_read','orders_read','listing_update','notification_process')),
  status text not null check (status in ('running','completed','partial','failed')),
  requested_by uuid,
  idempotency_key text,
  items_seen integer not null default 0 check (items_seen >= 0),
  items_written integer not null default 0 check (items_written >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, idempotency_key),
  foreign key (company_id, connection_id) references public.meli_connections(company_id, id) on delete cascade
);

create index if not exists meli_connections_company_status_idx on public.meli_connections(company_id, status);
create index if not exists meli_oauth_states_expiry_idx on public.meli_oauth_states(expires_at) where consumed_at is null;
create index if not exists meli_listing_links_product_idx on public.meli_listing_links(company_id, product_id);
create index if not exists meli_orders_date_idx on public.meli_orders(company_id, date_created desc);
create index if not exists meli_webhook_pending_idx on public.meli_webhook_events(status, next_attempt_at) where status in ('pending','retry');
create index if not exists meli_sync_runs_company_idx on public.meli_sync_runs(company_id, created_at desc);

alter table public.meli_connections enable row level security;
alter table public.meli_oauth_states enable row level security;
alter table public.meli_listing_links enable row level security;
alter table public.meli_orders enable row level security;
alter table public.meli_webhook_events enable row level security;
alter table public.meli_sync_runs enable row level security;

-- The API never reads token tables directly. Edge Functions verify membership,
-- role and the marketplace_integrations entitlement before service operations.
revoke all on public.meli_connections, public.meli_oauth_states,
  public.meli_listing_links, public.meli_orders, public.meli_webhook_events,
  public.meli_sync_runs from public, anon, authenticated;
grant select on public.meli_listing_links, public.meli_orders, public.meli_sync_runs
  to authenticated;
grant select, insert, update, delete on public.meli_connections, public.meli_oauth_states,
  public.meli_listing_links, public.meli_orders, public.meli_webhook_events,
  public.meli_sync_runs to service_role;

drop policy if exists meli_listing_links_tenant_read on public.meli_listing_links;
drop policy if exists meli_orders_tenant_read on public.meli_orders;
drop policy if exists meli_sync_runs_tenant_read on public.meli_sync_runs;
create policy meli_listing_links_tenant_read on public.meli_listing_links
  for select to authenticated using (
    public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor')
  );
create policy meli_orders_tenant_read on public.meli_orders
  for select to authenticated using (
    public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor')
  );
create policy meli_sync_runs_tenant_read on public.meli_sync_runs
  for select to authenticated using (
    public.current_company_role(company_id) in ('admin','gestor','comercial','vendedor')
  );

-- One-time atomic OAuth state consumption prevents replay and CSRF.
create or replace function public.meli_consume_oauth_state(p_state_hash text)
returns table(company_id uuid, user_id uuid, pkce_verifier_ciphertext text, pkce_verifier_iv text)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  update public.meli_oauth_states state
     set consumed_at = clock_timestamp()
   where state.state_hash = p_state_hash
     and state.consumed_at is null
     and state.expires_at > clock_timestamp()
  returning state.company_id, state.user_id, state.pkce_verifier_ciphertext, state.pkce_verifier_iv;
$$;

-- Refresh tokens rotate and are single-use. A lease serializes refreshes for
-- one company/account; the token values stay in this private RPC response.
create or replace function public.meli_claim_token_refresh(p_company_id uuid, p_connection_id uuid, p_lease_id uuid)
returns table(connection_id uuid, access_token_ciphertext text, access_token_iv text,
  refresh_token_ciphertext text, refresh_token_iv text, token_version bigint)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  update public.meli_connections connection
     set refresh_lease_id = p_lease_id,
         refresh_lease_until = clock_timestamp() + interval '90 seconds',
         updated_at = clock_timestamp()
   where connection.company_id = p_company_id
     and connection.id = p_connection_id
     and connection.status = 'connected'
     and connection.refresh_token_ciphertext is not null
     and (connection.refresh_lease_until is null or connection.refresh_lease_until < clock_timestamp())
  returning connection.id, connection.access_token_ciphertext, connection.access_token_iv,
    connection.refresh_token_ciphertext, connection.refresh_token_iv, connection.token_version;
$$;

create or replace function public.meli_complete_token_refresh(
  p_company_id uuid, p_connection_id uuid, p_lease_id uuid,
  p_access_ciphertext text, p_access_iv text, p_refresh_ciphertext text,
  p_refresh_iv text, p_expires_at timestamptz, p_scopes text[]
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare changed integer;
begin
  update public.meli_connections connection
     set access_token_ciphertext = p_access_ciphertext,
         access_token_iv = p_access_iv,
         refresh_token_ciphertext = p_refresh_ciphertext,
         refresh_token_iv = p_refresh_iv,
         access_token_expires_at = p_expires_at,
         scopes = coalesce(p_scopes, '{}'::text[]),
         token_version = connection.token_version + 1,
         refresh_lease_id = null,
         refresh_lease_until = null,
         last_error_code = null,
         updated_at = clock_timestamp()
   where connection.id = p_connection_id
     and connection.company_id = p_company_id
     and connection.refresh_lease_id = p_lease_id
     and connection.status = 'connected';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.meli_fail_token_refresh(
  p_company_id uuid, p_connection_id uuid, p_lease_id uuid, p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare changed integer;
begin
  update public.meli_connections connection
     set status = 'reauth_required',
         last_error_code = left(coalesce(p_error_code, 'REFRESH_UNCERTAIN'), 80),
         refresh_lease_id = null,
         refresh_lease_until = null,
         updated_at = clock_timestamp()
   where connection.id = p_connection_id
     and connection.company_id = p_company_id
     and connection.refresh_lease_id = p_lease_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.meli_claim_notification_events(p_company_id uuid, p_connection_id uuid, p_limit integer default 10)
returns table(id uuid, connection_id uuid, topic text, resource_path text, attempts integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_limit < 1 or p_limit > 20 then raise exception 'Invalid notification batch size'; end if;
  return query
    with candidates as (
      select event.id
      from public.meli_webhook_events event
      where event.company_id = p_company_id
        and event.connection_id = p_connection_id
        and event.status in ('pending','retry')
        and event.next_attempt_at <= clock_timestamp()
        and event.attempts < 6
      order by event.received_at
      for update skip locked
      limit p_limit
    ), claimed as (
      update public.meli_webhook_events event
         set status = 'processing', attempts = event.attempts + 1
        from candidates
       where event.id = candidates.id
      returning event.id, event.connection_id, event.topic, event.resource_path, event.attempts
    )
    select claimed.id, claimed.connection_id, claimed.topic, claimed.resource_path, claimed.attempts from claimed;
end;
$$;

create or replace function public.meli_enqueue_notification(
  p_company_id uuid, p_connection_id uuid, p_dedupe_key text, p_topic text, p_resource_path text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare inserted integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));
  if (select count(*) from public.meli_webhook_events event
      where event.company_id = p_company_id and event.status in ('pending','retry','processing')) >= 500 then
    return false;
  end if;
  insert into public.meli_webhook_events(company_id, connection_id, dedupe_key, topic, resource_path)
  values (p_company_id, p_connection_id, p_dedupe_key, p_topic, p_resource_path)
  on conflict (company_id, dedupe_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

revoke all on function public.meli_consume_oauth_state(text) from public, anon, authenticated;
revoke all on function public.meli_claim_token_refresh(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.meli_complete_token_refresh(uuid, uuid, uuid, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.meli_fail_token_refresh(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.meli_claim_notification_events(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.meli_enqueue_notification(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.meli_consume_oauth_state(text) to service_role;
grant execute on function public.meli_claim_token_refresh(uuid, uuid, uuid) to service_role;
grant execute on function public.meli_complete_token_refresh(uuid, uuid, uuid, text, text, text, text, timestamptz, text[]) to service_role;
grant execute on function public.meli_fail_token_refresh(uuid, uuid, uuid, text) to service_role;
grant execute on function public.meli_claim_notification_events(uuid, uuid, integer) to service_role;
grant execute on function public.meli_enqueue_notification(uuid, uuid, text, text, text) to service_role;

comment on table public.meli_connections is 'Private Mercado Livre OAuth connections; encrypted tokens are accessible only to trusted Edge Functions.';
comment on table public.meli_orders is 'Minimal order import snapshots; importing does not create F7 sales, stock movements or financial entries.';
comment on table public.meli_webhook_events is 'Untrusted Mercado Livre notification pointers; worker fetches authoritative resource data using the tenant connection.';
