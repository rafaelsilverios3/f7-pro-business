-- Enforce inbound WhatsApp message idempotency without global external-id uniqueness.
-- A full UNIQUE index is intentional: PostgreSQL permits multiple NULLs, and it
-- is inferable by PostgREST's onConflict(company_id,channel,external_message_id).

do $$
declare
  duplicate_groups bigint;
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
    raise exception '0030 aborted: % duplicate message key group(s) exist for company_id, channel, external_message_id; resolve duplicates before applying this migration', duplicate_groups
      using errcode = '23505';
  end if;
end
$$;

create unique index if not exists messages_company_channel_external_message_uidx
  on public.messages (company_id, channel, external_message_id);