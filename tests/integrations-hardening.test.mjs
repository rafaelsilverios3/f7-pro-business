import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('0014 closes direct integration writes and adds atomic controls',()=>{const s=fs.readFileSync('supabase/migrations/0014_integrations_hardening.sql','utf8'); assert.match(s,/revoke insert,update,delete on company_integrations/i); assert.match(s,/consume_rate_limit/); assert.match(s,/increment_usage/);});
test('webhook requires Meta subscribe verification and signature',()=>{const s=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8'); assert.match(s,/hub.mode.*subscribe/); assert.match(s,/x-hub-signature-256/); assert.match(s,/WHATSAPP_APP_SECRET/);});
test('authenticated integration health does not expose secrets',()=>{const s=fs.readFileSync('supabase/functions/integration-health/index.ts','utf8'); assert.match(s,/AUTH_REQUIRED/); assert.doesNotMatch(s,/service_role_configured/);});

