-- Replace the partial WhatsApp idempotency index with a complete UNIQUE index.
-- A complete index is required by PostgREST for ON CONFLICT on these columns.

do $$
declare
  duplicate_groups bigint;
  dependent_constraints bigint;
begin
  select count(*)
    into duplicate_groups
    from (
      select company_id, channel, external_message_id
      from public.messages
      where external_message_id is not null
      group by company_id, channel, external_message_id
      having count(*) > 1
    ) duplicates;

  if duplicate_groups > 0 then
    raise exception '0031 aborted: % duplicate message key group(s) exist for company_id, channel, external_message_id; resolve duplicates before replacing the index', duplicate_groups
      using errcode = '23505';
  end if;

  select count(*)
    into dependent_constraints
    from pg_depend dependency
    join pg_class index_relation on index_relation.oid = dependency.refobjid
    join pg_namespace index_schema on index_schema.oid = index_relation.relnamespace
    join pg_constraint dependent_constraint on dependent_constraint.oid = dependency.objid
    where dependency.classid = 'pg_constraint'::regclass
      and dependency.refclassid = 'pg_class'::regclass
      and index_schema.nspname = 'public'
      and index_relation.relname = 'messages_company_channel_external_message_uidx';

  if dependent_constraints > 0 then
    raise exception '0031 aborted: the existing WhatsApp message index has % dependent constraint(s); resolve dependencies before replacing it', dependent_constraints
      using errcode = '2BP01';
  end if;
end
$$;

drop index if exists public.messages_company_channel_external_message_uidx;

create unique index messages_company_channel_external_message_uidx
  on public.messages (company_id, channel, external_message_id);