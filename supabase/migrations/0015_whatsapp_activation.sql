alter table messages add column if not exists client_request_id uuid;
create unique index if not exists idx_messages_client_request on messages(company_id,client_request_id) where client_request_id is not null;
create index if not exists idx_conversations_whatsapp_phone on conversations(company_id,channel,lead_phone,status);
create index if not exists idx_whatsapp_contacts_phone on whatsapp_contacts(company_id,phone);
