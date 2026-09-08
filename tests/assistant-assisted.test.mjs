import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/assistant-suggest/index.ts', 'utf8');
const sources = fs.readFileSync('supabase/functions/_shared/officialSources.ts', 'utf8');
const page = fs.readFileSync('src/pages/Atendimento.jsx', 'utf8');
const permissions = fs.readFileSync('src/lib/permissions.js', 'utf8');
const service = fs.readFileSync('src/services/assistantSuggestService.js', 'utf8');

test('assisted suggestion is gated and never auto-sends', () => {
  assert.match(edge, /mode.*assisted/);
  assert.match(edge, /AI_ENABLED.*true/);
  assert.match(edge, /company_has_feature/);
  assert.match(edge, /consume_rate_limit/);
  assert.doesNotMatch(edge, /whatsapp-send/);
  assert.match(page, /Sugerir resposta/);
  assert.match(page, /Usar resposta/);
  assert.match(page, /Gerar novamente/);
  assert.doesNotMatch(service, /graph\.facebook\.com|WHATSAPP_ACCESS_TOKEN|SERVICE_ROLE/);
});

test('assistant resolves the company server-side and keeps context scoped', () => {
  assert.match(edge, /conversation_id/);
  assert.match(edge, /company_users/);
  assert.match(edge, /company_assistant_settings/);
  assert.match(edge, /eq\('company_id', conversation\.company_id\)/);
  assert.match(edge, /specific_rules/);
  assert.match(edge, /company_quick_replies/);
  assert.match(edge, /company_handoff_rules/);
  assert.match(edge, /segmentGuidance/);
  assert.match(edge, /Para John Deere/);
  assert.match(edge, /products/);
  assert.match(edge, /media_type/);
  assert.doesNotMatch(edge, /media_url|signedUrl/);
});

test('multisegment official source registry selects John Deere only for related context', () => {
  assert.match(sources, /OfficialSourcesRegistry/);
  assert.match(sources, /JohnDeereOfficialSource/);
  assert.match(sources, /partscatalog\.deere\.com/);
  assert.match(sources, /isJohnDeereContext/);
  assert.match(sources, /return isJohnDeereContext\(input\) \? \[JohnDeereOfficialSource\] : \[\]/);
  assert.match(sources, /OFFICIAL_SOURCE_UNAVAILABLE/);
  assert.match(edge, /manufacturer_official/);
});

test('permission is available to supported human roles while automatic mode stays blocked', () => {
  for (const role of ['gestor', 'comercial', 'vendedor', 'atendimento']) assert.match(permissions, new RegExp(`${role}:.*assistant\\.suggest`));
  assert.match(permissions, /assistant\.suggest/);
  assert.match(page, /mode === 'assisted'/);
  assert.match(edge, /AI_ENABLED/);
});
