create table if not exists company_subscriptions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null unique references companies(id) on delete cascade,
 plan text not null default 'free' check (plan in ('free','pro','business','premium')),
 status text not null default 'trial' check (status in ('trial','active','past_due','cancelled','suspended')),
 trial_ends_at timestamptz, current_period_start timestamptz, current_period_end timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists company_invites (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id) on delete cascade,
 email text not null, role text not null check (role in ('admin','gestor','financeiro','comercial','vendedor','estoque','atendimento')),
 token_hash text not null unique, status text not null default 'pending' check (status in ('pending','accepted','expired','cancelled')),
 expires_at timestamptz not null, invited_by uuid references profiles(id), accepted_by uuid references profiles(id),
 created_at timestamptz not null default now(), accepted_at timestamptz
);
alter table audit_logs add column if not exists metadata jsonb;
alter table company_users enable row level security;
create index if not exists idx_company_subscriptions_company on company_subscriptions(company_id);
create index if not exists idx_company_invites_company_status on company_invites(company_id,status);
create index if not exists idx_audit_logs_company_created on audit_logs(company_id,created_at desc);
create index if not exists idx_audit_logs_entity on audit_logs(entity,entity_id);

do $$ declare t text; begin foreach t in array array['company_subscriptions','company_invites'] loop execute format('alter table %I enable row level security',t); execute format('drop policy if exists company_isolation on %I',t); execute format('create policy company_isolation on %I for all using (is_company_member(company_id)) with check (is_company_member(company_id))',t); execute format('grant select, insert, update, delete on table %I to authenticated',t); end loop; end $$;

create or replace function accept_company_invite(invite_token_hash text) returns company_users language plpgsql security definer set search_path=public as $$
declare invitation company_invites; membership company_users;
begin
 select * into invitation from company_invites where token_hash=invite_token_hash and status='pending' and expires_at > now() for update;
 if invitation.id is null then raise exception 'Convite inválido, expirado ou já utilizado'; end if;
 insert into company_users(company_id,user_id,role,active) values(invitation.company_id,auth.uid(),invitation.role,true)
 on conflict (company_id,user_id) do update set active=true,role=excluded.role returning * into membership;
 update company_invites set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
 return membership;
end; $$;
revoke all on function accept_company_invite(text) from public,anon;
grant execute on function accept_company_invite(text) to authenticated;
