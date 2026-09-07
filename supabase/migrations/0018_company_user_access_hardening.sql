-- ETAPA 18: gestão segura de usuários, convites e último administrador.
-- Esta migration deve ser revisada e aplicada manualmente no Supabase.

-- Membros nunca alteram company_id, user_id, role ou active diretamente via Data API.
revoke insert, update, delete on table public.company_users from authenticated;
grant select on table public.company_users to authenticated;

create or replace function public.update_company_member_role(target_company uuid, target_user uuid, new_role text)
returns public.company_users
language plpgsql security definer set search_path = public
as $$
declare
  actor_role text;
  previous public.company_users;
  result public.company_users;
begin
  actor_role := public.current_company_role(target_company);
  if actor_role <> 'admin' then raise exception 'Somente administradores podem alterar papéis'; end if;
  if target_user = auth.uid() then raise exception 'Não é permitido alterar o próprio papel'; end if;
  if new_role not in ('admin','gestor','financeiro','comercial','vendedor','estoque','atendimento') then raise exception 'Papel inválido'; end if;
  select * into previous from public.company_users where company_id = target_company and user_id = target_user for update;
  if previous.id is null then raise exception 'Membro não encontrado'; end if;
  if previous.active and previous.role = 'admin' and new_role <> 'admin'
     and (select count(*) from public.company_users where company_id = target_company and role = 'admin' and active) <= 1
  then raise exception 'A empresa precisa manter pelo menos um administrador ativo'; end if;
  update public.company_users set role = new_role where id = previous.id returning * into result;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data)
    values(target_company,auth.uid(),'member.role_changed','CompanyUser',result.id,to_jsonb(previous),to_jsonb(result));
  return result;
end;
$$;

create or replace function public.set_company_member_active(target_company uuid, target_user uuid, is_active boolean)
returns public.company_users
language plpgsql security definer set search_path = public
as $$
declare
  actor_role text;
  previous public.company_users;
  result public.company_users;
begin
  actor_role := public.current_company_role(target_company);
  if actor_role <> 'admin' then raise exception 'Somente administradores podem ativar ou desativar usuários'; end if;
  if target_user = auth.uid() then raise exception 'Não é permitido desativar o próprio usuário'; end if;
  select * into previous from public.company_users where company_id = target_company and user_id = target_user for update;
  if previous.id is null then raise exception 'Membro não encontrado'; end if;
  if not is_active and previous.active and previous.role = 'admin'
     and (select count(*) from public.company_users where company_id = target_company and role = 'admin' and active) <= 1
  then raise exception 'A empresa precisa manter pelo menos um administrador ativo'; end if;
  update public.company_users set active = is_active where id = previous.id returning * into result;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,old_data,new_data)
    values(target_company,auth.uid(),case when is_active then 'member.reactivated' else 'member.deactivated' end,'CompanyUser',result.id,to_jsonb(previous),to_jsonb(result));
  return result;
end;
$$;

create or replace function public.create_company_invite(target_company uuid, invite_email text, invite_role text, invite_token_hash text, invite_expires_at timestamptz)
returns public.company_invites
language plpgsql security definer set search_path = public
as $$
declare result public.company_invites; normalized text;
begin
  if public.current_company_role(target_company) <> 'admin' then raise exception 'Somente administradores podem criar convites'; end if;
  if invite_role not in ('admin','gestor','financeiro','comercial','vendedor','estoque','atendimento') then raise exception 'Papel inválido'; end if;
  normalized := lower(trim(invite_email));
  if normalized = '' or invite_token_hash = '' or invite_expires_at <= now() then raise exception 'Dados do convite inválidos'; end if;
  if not public.company_within_limit(target_company,'users') then raise exception 'Limite de usuários do plano atingido'; end if;
  insert into public.company_invites(company_id,email,role,token_hash,expires_at,invited_by)
    values(target_company,normalized,invite_role,invite_token_hash,invite_expires_at,auth.uid()) returning * into result;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,metadata)
    values(target_company,auth.uid(),'invite.created','CompanyInvite',result.id,jsonb_build_object('email',normalized,'role',invite_role));
  return result;
end;
$$;

create or replace function public.cancel_company_invite(invite_id uuid)
returns public.company_invites
language plpgsql security definer set search_path = public
as $$
declare result public.company_invites;
begin
  if public.current_company_role((select company_id from public.company_invites where id = invite_id)) <> 'admin' then raise exception 'Somente administradores podem cancelar convites'; end if;
  update public.company_invites set status = 'cancelled' where id = invite_id and status = 'pending' returning * into result;
  if result.id is null then raise exception 'Convite não está pendente'; end if;
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,metadata)
    values(result.company_id,auth.uid(),'invite.cancelled','CompanyInvite',result.id,'{}');
  return result;
end;
$$;

revoke all on function public.update_company_member_role(uuid,uuid,text), public.set_company_member_active(uuid,uuid,boolean), public.create_company_invite(uuid,text,text,text,timestamptz), public.cancel_company_invite(uuid) from public, anon;
grant execute on function public.update_company_member_role(uuid,uuid,text), public.set_company_member_active(uuid,uuid,boolean), public.create_company_invite(uuid,text,text,text,timestamptz), public.cancel_company_invite(uuid) to authenticated;
