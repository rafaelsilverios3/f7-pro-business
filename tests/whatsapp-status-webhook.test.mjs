import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('0016 adds delivery diagnostics and filtered status index',()=>{const s=fs.readFileSync('supabase/migrations/0016_whatsapp_delivery_status.sql','utf8'); for(const c of ['external_status_at','external_error_code','external_error_title','external_error_details']) assert.match(s,new RegExp(c)); assert.match(s,/where external_message_id is not null/i);});
test('webhook processes batches and statuses without requiring messages',()=>{const s=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8'); assert.match(s,/webhookItems/); assert.match(s,/value\.statuses/); assert.match(s,/value\.messages/); assert.match(s,/processStatus/); assert.match(s,/external_status_at/);});
test('webhook supports safe media placeholders',()=>{const s=fs.readFileSync('supabase/functions/_shared/webhook.ts','utf8'); for(const t of ['image','audio','video','document','sticker','location','interactive','button']) assert.match(s,new RegExp(t));});

test('inbound webhook records safe stage diagnostics for each database operation',()=>{
  const s=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8');
  for (const stage of ['integration_lookup','customer_lookup','contact_upsert','conversation_lookup','conversation_insert','message_lookup','message_upsert','conversation_update','usage_increment','success_log']) assert.match(s,new RegExp(stage));
  assert.match(s,/safeError/);
  assert.match(s,/whatsapp_webhook_error/);
  assert.match(s,/stage: safe\.stage/);
  assert.match(s,/code: safe\.code/);
  assert.match(s,/error: safe\.message/);
});

test('webhook diagnostic metadata is sanitized and item failures do not change the 200 response',()=>{
  const s=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8');
  assert.match(s,/replace\(\/bearer/);
  assert.match(s,/replace\(\/\[\\w\.\+\-\]\+@/);
  assert.match(s,/return json\(\{ ok: true \}\)/);
  const diagnosticBlock = s.slice(s.indexOf("'whatsapp_webhook_error'"), s.indexOf("'whatsapp_webhook_error'") + 500);
  assert.doesNotMatch(diagnosticBlock,/phone|profile|content|token|secret/i);
});
