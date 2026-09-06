create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text, email text, avatar_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists goals (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id) on delete cascade,
  name text not null, type text not null default 'revenue', target_value numeric(14,2) not null default 0,
  period text not null default 'monthly', start_date date, end_date date, user_id uuid references profiles(id),
  status text not null default 'active', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade, type text not null, title text not null, message text not null,
  read boolean not null default false, entity text, entity_id uuid, created_at timestamptz not null default now()
);
create or replace function handle_new_user_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles(id, name, email) values(new.id, coalesce(new.raw_user_meta_data->>'name', new.email), new.email) on conflict (id) do update set email = excluded.email; return new; end; $$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute function handle_new_user_profile();
alter table profiles enable row level security;
alter table goals enable row level security;
alter table notifications enable row level security;
drop policy if exists profile_self on profiles;
create policy profile_self on profiles for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists goals_company on goals;
create policy goals_company on goals for all using (is_company_member(company_id)) with check (is_company_member(company_id));
drop policy if exists notifications_company on notifications;
create policy notifications_company on notifications for all using (is_company_member(company_id) and (user_id is null or user_id = auth.uid())) with check (is_company_member(company_id) and (user_id is null or user_id = auth.uid()));
grant select, insert, update, delete on table profiles, goals, notifications to authenticated;

create or replace function update_company_member_role(target_company uuid, target_user uuid, new_role text) returns company_users
language plpgsql security definer set search_path = public as $$
declare actor_role text; result company_users;
begin
  select role into actor_role from company_users where company_id = target_company and user_id = auth.uid() and active;
  if actor_role not in ('admin','gestor') then raise exception 'Sem permissão'; end if;
  if new_role not in ('admin','gestor','financeiro','comercial','vendedor','estoque','atendimento') then raise exception 'Papel inválido'; end if;
  if target_user = auth.uid() and new_role <> actor_role then raise exception 'Não é permitido alterar o próprio papel'; end if;
  update company_users set role = new_role where company_id = target_company and user_id = target_user returning * into result;
  if result.id is null then raise exception 'Membro não encontrado'; end if; return result;
end; $$;
create or replace function set_company_member_active(target_company uuid, target_user uuid, is_active boolean) returns company_users
language plpgsql security definer set search_path = public as $$
declare actor_role text; result company_users;
begin
  select role into actor_role from company_users where company_id = target_company and user_id = auth.uid() and active;
  if actor_role not in ('admin','gestor') then raise exception 'Sem permissão'; end if;
  if target_user = auth.uid() then raise exception 'Não é permitido desativar o próprio usuário'; end if;
  update company_users set active = is_active where company_id = target_company and user_id = target_user returning * into result;
  if result.id is null then raise exception 'Membro não encontrado'; end if; return result;
end; $$;
revoke all on function update_company_member_role(uuid, uuid, text) from public, anon;
revoke all on function set_company_member_active(uuid, uuid, boolean) from public, anon;
grant execute on function update_company_member_role(uuid, uuid, text), set_company_member_active(uuid, uuid, boolean) to authenticated;
