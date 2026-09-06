alter table companies add column if not exists legal_name text;
alter table companies add column if not exists document text;
alter table companies add column if not exists phone text;
alter table companies add column if not exists whatsapp text;
alter table companies add column if not exists email text;
alter table companies add column if not exists address text;
alter table companies add column if not exists currency text not null default 'BRL';

grant select, update on table companies to authenticated;

grant select, insert, update, delete on table quotes, commissions to authenticated;
