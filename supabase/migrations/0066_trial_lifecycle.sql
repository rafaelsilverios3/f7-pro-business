-- One-time 24-hour trial lifecycle. Existing active subscriptions are preserved.
alter table public.company_subscriptions add column if not exists trial_started_at timestamptz;
alter table public.company_subscriptions add column if not exists trial_used boolean not null default false;
alter table public.company_subscriptions drop constraint if exists company_subscriptions_status_check;
alter table public.company_subscriptions add constraint company_subscriptions_status_check check (status in ('trial','active','past_due','cancelled','suspended','expired'));

create or replace function public.create_company_with_owner(company_name text)
returns public.companies language plpgsql security definer set search_path = public as $$
declare created public.companies; trial_start timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Sessão Supabase obrigatória'; end if;
  if length(trim(coalesce(company_name, ''))) < 2 then raise exception 'Informe um nome de empresa válido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select c.* into created from public.companies c join public.company_users member on member.company_id = c.id where member.user_id = auth.uid() and member.active = true order by c.created_at asc limit 1;
  if found then return created; end if;
  insert into public.companies(name) values (trim(company_name)) returning * into created;
  insert into public.company_users(company_id, user_id, role, active) values (created.id, auth.uid(), 'admin', true);
  insert into public.company_subscriptions(company_id, plan, status, trial_started_at, trial_ends_at, trial_used, current_period_start, current_period_end)
    values (created.id, 'free', 'trial', trial_start, trial_start + interval '24 hours', false, trial_start, trial_start + interval '24 hours');
  insert into public.audit_logs(company_id, user_id, action, entity, entity_id, new_data) values (created.id, auth.uid(), 'company.created', 'Company', created.id, jsonb_build_object('company', to_jsonb(created), 'trial_started_at', trial_start, 'trial_ends_at', trial_start + interval '24 hours'));
  return created;
end; $$;
revoke all on function public.create_company_with_owner(text) from public, anon;
grant execute on function public.create_company_with_owner(text) to authenticated;

create or replace function public.sync_company_trial(target_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.company_users where company_id = target_company and user_id = auth.uid() and active) then raise exception 'FORBIDDEN'; end if;
  update public.company_subscriptions set status = 'expired', trial_used = true, updated_at = now()
   where company_id = target_company and status = 'trial' and trial_ends_at is not null and trial_ends_at <= now();
end; $$;
revoke all on function public.sync_company_trial(uuid) from public, anon;
grant execute on function public.sync_company_trial(uuid) to authenticated, service_role;

create or replace function public.company_has_feature(target_company uuid, feature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare plan_name text; subscription_status text; trial_end timestamptz; override_enabled boolean; configured boolean;
begin
  select o.enabled into override_enabled from public.company_feature_overrides o where o.company_id = target_company and o.feature = lower(trim($2));
  select coalesce(s.plan, 'free'), s.status, s.trial_ends_at into plan_name, subscription_status, trial_end from public.company_subscriptions s where s.company_id = target_company;
  if subscription_status = 'trial' and (trial_end is null or trial_end <= now()) then return false; end if;
  if subscription_status in ('expired','cancelled','suspended','past_due') then return false; end if;
  if override_enabled is not null then return override_enabled; end if;
  select pf.enabled into configured from public.plan_features pf join public.plans p on p.id = pf.plan_id where p.code = plan_name and p.active and pf.feature = lower(trim($2));
  if configured is not null then return configured; end if;
  return case lower(trim($2))
    when 'intelligence' then plan_name in ('pro','business','premium')
    when 'automations' then plan_name in ('business','premium')
    when 'atendimento' then plan_name in ('business','premium')
    when 'advanced_reports' then plan_name in ('business','premium')
    when 'whatsapp' then plan_name in ('business','premium')
    when 'ai' then plan_name = 'premium'
    when 'ai_sales' then plan_name in ('pro','business','premium')
    when 'opportunity_radar' then plan_name in ('business','premium')
    when 'supplier_intelligence' then plan_name = 'premium'
    when 'external_product_intelligence' then plan_name in ('business','premium')
    else false
  end;
end; $$;
revoke all on function public.company_has_feature(uuid, text) from public, anon;
grant execute on function public.company_has_feature(uuid, text) to authenticated, service_role;
