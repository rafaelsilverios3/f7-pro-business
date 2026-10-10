-- Etapa 12: atividades comerciais persistentes, tenant-scoped e sem automação externa.
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  opportunity_id uuid,
  created_by uuid not null default auth.uid(),
  assigned_to uuid,
  activity_type text not null,
  status text not null default 'PENDENTE',
  title text not null,
  description text,
  due_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_activities_type_check check (activity_type in ('ligacao','whatsapp','email','reuniao','visita','proposta','retorno','tarefa','outro')),
  constraint crm_activities_status_check check (status in ('PENDENTE','CONCLUIDA','CANCELADA')),
  constraint crm_activities_terminal_dates_check check (
    (status = 'PENDENTE' and completed_at is null and cancelled_at is null)
    or (status = 'CONCLUIDA' and completed_at is not null and cancelled_at is null)
    or (status = 'CANCELADA' and cancelled_at is not null and completed_at is null)
  )
);

create index if not exists idx_crm_activities_company_due on public.crm_activities(company_id, status, due_at);
create index if not exists idx_crm_activities_company_customer on public.crm_activities(company_id, customer_id, created_at desc);
create index if not exists idx_crm_activities_company_opportunity on public.crm_activities(company_id, opportunity_id, created_at desc);
create index if not exists idx_crm_activities_company_assignee on public.crm_activities(company_id, assigned_to, status, due_at);

create or replace function public.validate_crm_activity_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.title is null or length(btrim(new.title)) = 0 then
    raise exception 'Título da atividade é obrigatório';
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if tg_op = 'INSERT' and new.created_by is distinct from auth.uid() then
    raise exception 'created_by deve ser o usuário autenticado';
  end if;
  if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    raise exception 'created_by não pode ser alterado';
  end if;

  if new.customer_id is not null and not exists (
    select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id
  ) then
    raise exception 'Cliente não pertence à empresa da atividade';
  end if;

  -- opportunities é o CRM operacional e product_opportunities é o Radar.
  -- O vínculo polimórfico é validado aqui porque os dois domínios usam tabelas
  -- diferentes e não é seguro escolher uma FK que aceite apenas um deles.
  if new.opportunity_id is not null and not exists (
    select 1 from public.opportunities o where o.id = new.opportunity_id and o.company_id = new.company_id
    union all
    select 1 from public.product_opportunities p where p.id = new.opportunity_id and p.company_id = new.company_id
  ) then
    raise exception 'Oportunidade não pertence à empresa da atividade';
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.company_users m where m.company_id = new.company_id and m.user_id = new.assigned_to and m.active
  ) then
    raise exception 'Responsável não é membro ativo da empresa';
  end if;

  if new.status = 'PENDENTE' then
    new.completed_at := null;
    new.cancelled_at := null;
  elsif new.status = 'CONCLUIDA' then
    new.completed_at := coalesce(new.completed_at, now());
    new.cancelled_at := null;
  elsif new.status = 'CANCELADA' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_activities_validate_links on public.crm_activities;
create trigger crm_activities_validate_links
before insert or update on public.crm_activities
for each row execute function public.validate_crm_activity_links();

drop trigger if exists crm_activities_set_updated_at on public.crm_activities;
create trigger crm_activities_set_updated_at
before update on public.crm_activities
for each row execute function public.set_updated_at();

alter table public.crm_activities enable row level security;
drop policy if exists crm_activities_select on public.crm_activities;
create policy crm_activities_select on public.crm_activities
for select using (
  is_company_member(company_id)
  and (
    current_company_role(company_id) in ('admin', 'gestor', 'comercial')
    or created_by = auth.uid()
    or assigned_to = auth.uid()
  )
);
drop policy if exists crm_activities_insert on public.crm_activities;
create policy crm_activities_insert on public.crm_activities
for insert with check (
  is_company_member(company_id)
  and created_by = auth.uid()
);
drop policy if exists crm_activities_update on public.crm_activities;
create policy crm_activities_update on public.crm_activities
for update using (
  is_company_member(company_id)
  and (
    current_company_role(company_id) in ('admin', 'gestor', 'comercial')
    or created_by = auth.uid()
    or assigned_to = auth.uid()
  )
) with check (
  is_company_member(company_id)
  and (
    current_company_role(company_id) in ('admin', 'gestor', 'comercial')
    or created_by = auth.uid()
    or assigned_to = auth.uid()
  )
);

grant select, insert, update on table public.crm_activities to authenticated;
revoke delete on table public.crm_activities from authenticated;
-- Conceptual rollback: remove this migration's policies, triggers, helper,
-- grants, indexes, and crm_activities table in dependency order after disabling
-- dependent app/worker paths. Dropping the table permanently removes activity
-- history; export/backup it first. Reverting policy/trigger DDL alone preserves
-- rows but may expose invalid links or stop timestamp/tenant validation.
