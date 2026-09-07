alter table messages add column if not exists external_status_at timestamptz;
alter table messages add column if not exists external_error_code text;
alter table messages add column if not exists external_error_title text;
alter table messages add column if not exists external_error_details text;
create index if not exists idx_messages_external_status on messages(company_id,channel,external_status) where external_message_id is not null;
