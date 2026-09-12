-- Convites empresariais usam a rota pública do F7; o token continua somente como hash no banco.
-- Aplicar manualmente após revisão. Rollback conceitual: restaurar as funções de convite da migration 0018.

create or replace function public.get_company_invite_preview(invite_token_hash text)
returns table(company_name text, invited_email text, invite_role text, invite_status text, invite_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.name, i.email, i.role, case when i.status='pending' and i.expires_at <= now() then 'expired' else i.status end, i.expires_at
    from public.company_invites i
    join public.companies c on c.id=i.company_id
    where i.token_hash=invite_token_hash;
end; $$;

create or replace function public.accept_company_invite(invite_token_hash text)
returns public.company_users
language plpgsql security definer set search_path = public as $$
declare invitation public.company_invites; membership public.company_users; auth_email text;
begin
  if auth.uid() is null then raise exception 'Sessão obrigatória'; end if;
  select * into invitation from public.company_invites where token_hash=invite_token_hash for update;
  if invitation.id is null then raise exception 'Convite inválido'; end if;
  if invitation.status='accepted' then
    if invitation.accepted_by=auth.uid() then
      select * into membership from public.company_users where company_id=invitation.company_id and user_id=auth.uid();
      if membership.id is not null then return membership; end if;
    end if;
    raise exception 'Convite já utilizado';
  end if;
  if invitation.status='cancelled' then raise exception 'Convite revogado'; end if;
  if invitation.expires_at <= now() then
    update public.company_invites set status='expired' where id=invitation.id and status='pending';
    raise exception 'Convite expirado';
  end if;
  select lower(trim(email)) into auth_email from auth.users where id=auth.uid();
  if lower(trim(coalesce(auth_email,''))) <> lower(trim(invitation.email)) then raise exception 'Este convite pertence a outro e-mail'; end if;
  insert into public.company_users(company_id,user_id,role,active) values(invitation.company_id,auth.uid(),invitation.role,true)
  on conflict (company_id,user_id) do update set active=true, role=excluded.role returning * into membership;
  update public.company_invites set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id and status='pending';
  insert into public.audit_logs(company_id,user_id,action,entity,entity_id,metadata) values(invitation.company_id,auth.uid(),'invite.accepted','CompanyInvite',invitation.id,'{}');
  return membership;
end; $$;

revoke all on function public.get_company_invite_preview(text) from public;
grant execute on function public.get_company_invite_preview(text) to anon, authenticated;
revoke all on function public.accept_company_invite(text) from public, anon;
grant execute on function public.accept_company_invite(text) to authenticated;
