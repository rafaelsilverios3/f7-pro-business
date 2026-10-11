-- F7 platform administration foundation. Apply manually after auditing the remote schema.
create table if not exists public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','admin','support','readonly')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  last_access_at timestamptz
);
create unique index if not exists platform_admins_user_id_key on public.platform_admins(user_id);

create table if not exists public.platform_company_warnings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  category text not null default 'Outros',
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','resolved','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution_notes text
);
create index if not exists platform_company_warnings_company_status_idx on public.platform_company_warnings(company_id,status,created_at desc);

create table if not exists public.platform_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  company_id uuid references public.companies(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists platform_admin_audit_logs_created_idx on public.platform_admin_audit_logs(created_at desc);
create index if not exists platform_admin_audit_logs_company_idx on public.platform_admin_audit_logs(company_id,created_at desc);

alter table public.platform_admins enable row level security;
alter table public.platform_company_warnings enable row level security;
alter table public.platform_admin_audit_logs enable row level security;
revoke all on public.platform_admins, public.platform_company_warnings, public.platform_admin_audit_logs from anon, authenticated;
grant select, insert, update on public.platform_admins, platform_company_warnings, platform_admin_audit_logs to service_role;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid() and status = 'active'
  );
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

comment on table public.platform_admins is 'Explicit platform-level administrators. Never use email as authorization.';
-- Conceptual rollback: remove this migration's policies, helper function,
-- grants, indexes, and tables in dependency order only after disabling dependent
-- application paths. Dropping tables destroys platform-admin, warning, and
-- audit records; export/backup and retain them before any destructive rollback.
