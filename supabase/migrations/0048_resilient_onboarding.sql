-- Resilient first-company onboarding. Apply manually after review.
-- Retries/callback races return the authenticated user's existing company
-- instead of creating a second company. This does not broaden RLS access.
create or replace function public.create_company_with_owner(company_name text)
returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.companies;
begin
  if auth.uid() is null then
    raise exception 'Sessão Supabase obrigatória';
  end if;
  if length(trim(coalesce(company_name, ''))) < 2 then
    raise exception 'Informe um nome de empresa válido';
  end if;

  -- Serialize the first-company decision per authenticated user for the
  -- duration of this transaction. Without this lock, two concurrent retries
  -- could both miss membership and create two companies.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  -- Idempotent onboarding: a retry after a committed RPC returns the same
  -- company and membership instead of inserting another company.
  select c.* into created
    from public.companies c
    join public.company_users member on member.company_id = c.id
   where member.user_id = auth.uid()
     and member.active = true
   order by c.created_at asc
   limit 1;
  if found then
    return created;
  end if;

  insert into public.companies(name)
  values (trim(company_name))
  returning * into created;

  insert into public.company_users(company_id, user_id, role, active)
  values (created.id, auth.uid(), 'admin', true);

  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, new_data)
  values (created.id, auth.uid(), 'company.created', 'Company', created.id, to_jsonb(created));

  return created;
end;
$$;

revoke all on function public.create_company_with_owner(text) from public, anon;
grant execute on function public.create_company_with_owner(text) to authenticated;

-- Conceptual rollback: restore the previous function body from 0005_auth_bootstrap.sql.
