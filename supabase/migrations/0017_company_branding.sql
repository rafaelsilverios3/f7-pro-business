-- Branding por empresa. Aplicar manualmente no Supabase antes de usar o upload.
alter table public.companies add column if not exists logo_path text;

insert into storage.buckets (id, name, public)
values ('company-branding', 'company-branding', false)
on conflict (id) do nothing;

drop policy if exists company_branding_read on storage.objects;
create policy company_branding_read on storage.objects
for select to authenticated
using (
  bucket_id = 'company-branding'
  and is_company_member((storage.foldername(name))[1]::uuid)
);

drop policy if exists company_branding_admin_insert on storage.objects;
create policy company_branding_admin_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'company-branding'
  and current_company_role((storage.foldername(name))[1]::uuid) = 'admin'
);

drop policy if exists company_branding_admin_update on storage.objects;
create policy company_branding_admin_update on storage.objects
for update to authenticated
using (
  bucket_id = 'company-branding'
  and current_company_role((storage.foldername(name))[1]::uuid) = 'admin'
)
with check (
  bucket_id = 'company-branding'
  and current_company_role((storage.foldername(name))[1]::uuid) = 'admin'
);

drop policy if exists company_branding_admin_delete on storage.objects;
create policy company_branding_admin_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'company-branding'
  and current_company_role((storage.foldername(name))[1]::uuid) = 'admin'
);

drop policy if exists company_admin_update_branding on public.companies;
create policy company_admin_update_branding on public.companies
for update to authenticated
using (current_company_role(id) = 'admin')
with check (current_company_role(id) = 'admin');

grant update (logo_path) on public.companies to authenticated;

