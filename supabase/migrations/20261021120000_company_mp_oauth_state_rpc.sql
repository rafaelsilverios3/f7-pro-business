-- Conceptual rollback: stop new OAuth starts first. Revoke this RPC from authenticated users and drop it only after all outstanding authorization states have expired; preserve audit records and connected merchant tokens.
create or replace function public.company_mp_create_oauth_state(
  p_company uuid,
  p_state_hash text,
  p_pkce_verifier text
) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not public.is_company_member(p_company)
    or public.current_company_role(p_company) not in ('admin','gestor','financeiro') then
    raise exception 'MP_OAUTH_FORBIDDEN';
  end if;
  if p_state_hash !~ '^[a-f0-9]{64}$'
    or p_pkce_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' then
    raise exception 'MP_OAUTH_STATE_INVALID';
  end if;
  insert into public.company_mp_oauth_states(state_hash,company_id,user_id,pkce_verifier,expires_at)
    values(p_state_hash,p_company,actor,p_pkce_verifier,now()+interval '10 minutes');
  return true;
end; $$;
revoke all on function public.company_mp_create_oauth_state(uuid,text,text) from public,anon;
grant execute on function public.company_mp_create_oauth_state(uuid,text,text) to authenticated;
