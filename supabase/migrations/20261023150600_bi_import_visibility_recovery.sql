begin;

-- Keep BI import rows hidden from other company members while the import is
-- incomplete, but let the original uploader validate and recover their own
-- staged/failed version. The completion trigger runs as the calling role and
-- must be able to count the rows before changing the import to complete.
drop policy if exists bi_items_select on public.bi_items;
create policy bi_items_select on public.bi_items
for select to authenticated
using (
  public.current_company_role(company_id) in ('admin', 'gestor', 'comercial')
  and public.company_has_feature(company_id, 'business_intelligence')
  and exists (
    select 1
    from public.bi_imports p
    where p.id = bi_items.import_id
      and p.company_id = bi_items.company_id
      and (
        p.status = 'complete'
        or (p.status in ('staging', 'failed') and p.created_by = auth.uid())
      )
  )
);

-- A fully written failed version can be promoted after a transient finalize
-- failure. Its identity/metadata remain immutable and the row count is still
-- verified before the status transition is accepted.
drop policy if exists bi_imports_update on public.bi_imports;
create policy bi_imports_update on public.bi_imports
for update to authenticated
using (
  public.current_company_role(company_id) in ('admin', 'gestor', 'comercial')
  and public.company_has_feature(company_id, 'business_intelligence')
  and status in ('staging', 'failed')
  and created_by = auth.uid()
)
with check (
  public.current_company_role(company_id) in ('admin', 'gestor', 'comercial')
  and public.company_has_feature(company_id, 'business_intelligence')
  and status in ('staging', 'complete', 'failed')
  and created_by = auth.uid()
);

create or replace function public.bi_protect_version_identity()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'bi_studies' then
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id or new.created_by is distinct from old.created_by then
      raise exception 'BI_STUDY_IDENTITY_IMMUTABLE';
    end if;
  elsif tg_table_name = 'bi_imports' then
    if new.id is distinct from old.id
      or new.company_id is distinct from old.company_id
      or new.study_id is distinct from old.study_id
      or new.version is distinct from old.version
      or new.source_filename is distinct from old.source_filename
      or new.source_sha256 is distinct from old.source_sha256
      or new.data_cutoff is distinct from old.data_cutoff
      or new.source_metadata is distinct from old.source_metadata
      or new.methodology is distinct from old.methodology
      or new.row_count is distinct from old.row_count
      or new.created_by is distinct from old.created_by then
      raise exception 'BI_IMPORT_IMMUTABLE';
    end if;
    if not (
      (old.status = 'staging' and new.status in ('complete', 'failed'))
      or (old.status = 'failed' and new.status = 'complete')
    ) then
      raise exception 'BI_IMPORT_STATUS_TRANSITION_INVALID';
    end if;
    if new.status = 'complete' and new.completed_at is null then
      raise exception 'BI_IMPORT_COMPLETION_TIME_REQUIRED';
    end if;
    if new.status = 'complete' and (
      new.row_count = 0
      or (
        select count(*)
        from public.bi_items i
        where i.company_id = new.company_id
          and i.import_id = new.id
      ) <> new.row_count
    ) then
      raise exception 'BI_IMPORT_ROW_COUNT_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bi_protect_version_identity() from public, anon, authenticated;

commit;
