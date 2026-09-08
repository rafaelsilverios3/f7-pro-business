import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0033_whatsapp_media.sql', 'utf8');
const webhook = fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts', 'utf8');
const shared = fs.readFileSync('supabase/functions/_shared/webhook.ts', 'utf8');
const inbox = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const service = fs.readFileSync('src/services/conversationsService.js', 'utf8');

test('media migration creates private company-isolated storage and optional message fields', () => {
  assert.match(migration, /whatsapp-media.*false/);
  assert.match(migration, /media_path/);
  assert.match(migration, /media_mime_type/);
  assert.match(migration, /public\.is_company_member/);
});

test('webhook extracts supported media and downloads only server-side', () => {
  for (const type of ['image', 'video', 'audio', 'document', 'sticker']) assert.match(shared, new RegExp(`'${type}'`));
  assert.match(webhook, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(webhook, /storage\.from\('whatsapp-media'\)/);
  assert.match(webhook, /MEDIA_LIMIT/);
  assert.doesNotMatch(inbox, /WHATSAPP_ACCESS_TOKEN|graph\.facebook\.com/);
});

test('frontend creates short signed URLs and renders safe media fallbacks', () => {
  assert.match(service, /createSignedUrl\(row\.media_path, 300\)/);
  assert.match(inbox, /Mídia indisponível/);
  assert.match(inbox, /<video controls/);
  assert.match(inbox, /<audio controls/);
  assert.match(inbox, /media_type === 'sticker'/);
  assert.match(inbox, /media_filename/);
});
