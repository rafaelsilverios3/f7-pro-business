alter table companies
  add column if not exists onboarding_completed boolean not null default false;

grant select, update on table companies to authenticated;

drop policy if exists company_member_update on companies;
create policy company_member_update on companies
  for update using (is_company_member(id))
  with check (is_company_member(id));
