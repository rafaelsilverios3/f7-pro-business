import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/0032_company_assistant_configuration.sql', 'utf8');
const service = fs.readFileSync('src/services/assistantSettingsService.js', 'utf8');
const page = fs.readFileSync('src/pages/AssistenteConfiguracao.jsx', 'utf8');
const permissions = fs.readFileSync('src/lib/permissions.js', 'utf8');

test('assistant configuration migration is company scoped with manual default and RLS', () => {
  assert.match(migration, /create table if not exists public\.company_assistant_settings/);
  assert.match(migration, /company_id uuid not null unique references public\.companies/);
  assert.match(migration, /mode text not null default 'manual'/);
  assert.match(migration, /mode in \('manual','assisted','automatic'\)/);
  assert.doesNotMatch(migration, /handoff_rules jsonb/);
  assert.match(migration, /company_handoff_rules/);
  assert.match(migration, /create or replace function public\.set_updated_at\(\)/);
  assert.match(migration, /company_assistant_settings_set_updated_at/);
  assert.match(migration, /company_quick_replies_set_updated_at/);
  assert.match(migration, /company_handoff_rules_set_updated_at/);
  assert.match(migration, /alter table public\.company_assistant_settings enable row level security/);
  assert.match(migration, /current_company_role\(company_id\)/);
  assert.doesNotMatch(migration, /access_token|app_secret|service_role|raw_prompt/i);
});

test('assistant service whitelists fields and validates controlled placeholders', () => {
  assert.match(service, /SETTINGS_FIELDS/);
  assert.match(service, /onConflict: 'company_id'/);
  assert.match(service, /QUICK_REPLY_PLACEHOLDERS/);
  assert.match(service, /Placeholder não permitido/);
  assert.match(service, /listHandoffRules/);
  assert.doesNotMatch(service, /graph\.facebook\.com|WHATSAPP_ACCESS_TOKEN|AI_ENABLED/);
});

test('assistant UI keeps automatic modes unavailable and preview is local', () => {
  assert.match(page, /Manual · ativo/);
  assert.match(page, /Assistido · em breve/);
  assert.match(page, /Automático · em breve/);
  assert.match(page, /Nenhuma resposta é gerada automaticamente/);
  assert.match(page, /Preview do atendimento/);
  assert.doesNotMatch(page, /invokeEdgeFunction|graph\.facebook\.com|VITE_AI_ENABLED/);
});

test('assistant permissions separate view from management', () => {
  assert.match(permissions, /assistant_settings\.view/);
  assert.match(permissions, /assistant_settings\.manage/);
  assert.match(permissions, /quick_replies\.view/);
  assert.match(permissions, /quick_replies\.manage/);
});
