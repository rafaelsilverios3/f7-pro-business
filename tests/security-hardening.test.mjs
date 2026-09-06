import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canUseFeature, withinLimit } from '../src/services/planService.js';
test('plan gates keep premium features out of free plans',()=>{ assert.equal(canUseFeature('free','whatsapp'),false); assert.equal(canUseFeature('business','atendimento'),true); assert.equal(withinLimit('free','users',1),false); });
test('security migration enforces invite email and revokes direct writes',()=>{ const sql=fs.readFileSync('supabase/migrations/0012_saas_security_hardening.sql','utf8'); assert.match(sql,/revoke insert, update, delete on table company_subscriptions/i); assert.match(sql,/auth\.users/); assert.match(sql,/create_company_invite/); assert.match(sql,/invite_cancelled/); });
