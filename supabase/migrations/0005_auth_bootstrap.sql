alter table company_users drop constraint if exists company_users_role_check;
alter table company_users add constraint company_users_role_check check (role in ('admin','gestor','financeiro','comercial','vendedor','estoque','atendimento'));
create index if not exists idx_company_users_user_active on company_users(user_id, active);
create index if not exists idx_company_users_company_active on company_users(company_id, active);

create or replace function create_company_with_owner(company_name text) returns companies language plpgsql security definer set search_path = public as $$
declare created companies;
begin
  if auth.uid() is null then raise exception 'Sessão Supabase obrigatória'; end if;
  if length(trim(coalesce(company_name, ''))) < 2 then raise exception 'Informe um nome de empresa válido'; end if;
  insert into companies(name) values(trim(company_name)) returning * into created;
  insert into company_users(company_id, user_id, role, active) values(created.id, auth.uid(), 'admin', true);
  insert into audit_logs(company_id, user_id, action, entity, entity_id, new_data) values(created.id, auth.uid(), 'company.created', 'Company', created.id, to_jsonb(created));
  return created;
end; $$;
revoke all on function create_company_with_owner(text) from public, anon;
grant execute on function create_company_with_owner(text) to authenticated;
