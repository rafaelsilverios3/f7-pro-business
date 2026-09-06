-- Security hardening after 0011. No destructive data changes.
revoke insert, update, delete on table company_subscriptions from authenticated;
revoke insert, update, delete on table company_invites from authenticated;
grant select on table company_subscriptions to authenticated;
revoke all on table company_invites from authenticated;
grant select on table company_invites to authenticated;

drop policy if exists company_isolation on company_subscriptions;
create policy subscription_member_select on company_subscriptions for select using (is_company_member(company_id));
drop policy if exists company_isolation on company_invites;
create policy invite_admin_select on company_invites for select using (exists (select 1 from company_users m where m.company_id=company_invites.company_id and m.user_id=auth.uid() and m.active and m.role in ('admin','gestor')));

create or replace function current_company_role(company_uuid uuid) returns text language sql stable security definer set search_path=public as $$ select role from company_users where company_id=company_uuid and user_id=auth.uid() and active limit 1 $$;
create or replace function company_within_limit(target_company uuid, resource text) returns boolean language plpgsql stable security definer set search_path=public as $$
declare p text; max_count numeric; current_count numeric;
begin select coalesce(plan,'free') into p from company_subscriptions where company_id=target_company; if p is null then p:='free'; end if;
 max_count := case when resource='users' and p='free' then 1 when resource='users' and p='pro' then 3 when resource='users' and p='business' then 10 when resource='users' then 2147483647 when resource='automations' and p='free' then 0 when resource='automations' and p='pro' then 5 else 2147483647 end;
 current_count := case when resource='users' then (select count(*) from company_users where company_id=target_company and active) when resource='automations' then (select count(*) from automations where company_id=target_company and active) else 0 end;
 return current_count < max_count;
end; $$;
create or replace function company_has_feature(target_company uuid, feature text) returns boolean language sql stable security definer set search_path=public as $$
 select case when feature='automations' then company_within_limit(target_company,'automations') else true end $$;

create or replace function create_company_invite(target_company uuid, invite_email text, invite_role text, invite_token_hash text, invite_expires_at timestamptz) returns company_invites language plpgsql security definer set search_path=public as $$
declare actor text; result company_invites; normalized text;
begin
 if auth.uid() is null then raise exception 'Sessão obrigatória'; end if; actor:=current_company_role(target_company); if actor not in ('admin','gestor') then raise exception 'Sem permissão'; end if;
 if actor='gestor' and invite_role='admin' then raise exception 'Gestor não pode convidar administrador'; end if;
 if not company_within_limit(target_company,'users') then raise exception 'Limite de usuários do plano atingido'; end if;
 if invite_role not in ('admin','gestor','financeiro','comercial','vendedor','estoque','atendimento') then raise exception 'Papel inválido'; end if;
 normalized:=lower(trim(invite_email)); if normalized='' or invite_token_hash='' or invite_expires_at<=now() then raise exception 'Dados do convite inválidos'; end if;
 insert into company_invites(company_id,email,role,token_hash,expires_at,invited_by) values(target_company,normalized,invite_role,invite_token_hash,invite_expires_at,auth.uid()) returning * into result;
 insert into audit_logs(company_id,user_id,action,entity,entity_id,metadata) values(target_company,auth.uid(),'invite_created','CompanyInvite',result.id,jsonb_build_object('email',normalized,'role',invite_role)); return result;
end; $$;
create or replace function cancel_company_invite(invite_id uuid) returns company_invites language plpgsql security definer set search_path=public as $$
declare result company_invites;
begin
 if current_company_role((select company_id from company_invites where id=invite_id)) not in ('admin','gestor') then raise exception 'Sem permissão'; end if;
 update company_invites set status='cancelled' where id=invite_id and status='pending' returning * into result; if result.id is null then raise exception 'Convite não está pendente'; end if;
 insert into audit_logs(company_id,user_id,action,entity,entity_id,metadata) values(result.company_id,auth.uid(),'invite_cancelled','CompanyInvite',result.id,'{}'); return result;
end; $$;

create or replace function accept_company_invite(invite_token_hash text) returns company_users language plpgsql security definer set search_path=public as $$
declare invitation company_invites; membership company_users; auth_email text;
begin
 if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
 select email into auth_email from auth.users where id=auth.uid();
 select * into invitation from company_invites where token_hash=invite_token_hash and status='pending' and expires_at>now() for update;
 if invitation.id is null then raise exception 'Convite inválido, expirado ou já utilizado'; end if;
 if lower(trim(coalesce(auth_email,'')))<>lower(trim(invitation.email)) then raise exception 'Este convite pertence a outro e-mail'; end if;
 if exists (select 1 from company_users where company_id=invitation.company_id and user_id=auth.uid() and active and role in ('admin','gestor')) then raise exception 'Usuário já possui acesso a esta empresa'; end if;
 if not company_within_limit(invitation.company_id,'users') then raise exception 'Limite de usuários do plano atingido'; end if;
 insert into company_users(company_id,user_id,role,active) values(invitation.company_id,auth.uid(),invitation.role,true) on conflict (company_id,user_id) do update set active=true, role=case when company_users.role in ('admin','gestor') then company_users.role else excluded.role end returning * into membership;
 update company_invites set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
 insert into audit_logs(company_id,user_id,action,entity,entity_id,metadata) values(invitation.company_id,auth.uid(),'invite_accepted','CompanyInvite',invitation.id,'{}'); return membership;
end; $$;
revoke all on function current_company_role(uuid),company_within_limit(uuid,text),company_has_feature(uuid,text),create_company_invite(uuid,text,text,text,timestamptz),cancel_company_invite(uuid),accept_company_invite(text) from public,anon;
grant execute on function current_company_role(uuid),company_within_limit(uuid,text),company_has_feature(uuid,text),create_company_invite(uuid,text,text,text,timestamptz),cancel_company_invite(uuid),accept_company_invite(text) to authenticated;
