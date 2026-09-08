-- Private WhatsApp media storage and optional message metadata. Not applied remotely.
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_mime_type text;
alter table public.messages add column if not exists media_filename text;
alter table public.messages add column if not exists media_size bigint;
alter table public.messages add column if not exists media_caption text;
alter table public.messages add column if not exists media_type text;

insert into storage.buckets (id, name, public) values ('whatsapp-media', 'whatsapp-media', false) on conflict (id) do nothing;
drop policy if exists whatsapp_media_select on storage.objects;
create policy whatsapp_media_select on storage.objects for select to authenticated
using (bucket_id = 'whatsapp-media' and public.is_company_member((storage.foldername(name))[1]::uuid));
