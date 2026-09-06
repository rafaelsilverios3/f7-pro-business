import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('smart modules migration defines isolated tables and RLS', () => {
  const sql = fs.readFileSync('supabase/migrations/0010_smart_modules.sql', 'utf8');
  for (const table of ['conversations','messages','opportunities','automations','automation_runs','intelligence_insights']) assert.match(sql, new RegExp(`create table if not exists ${table}`));
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /company_isolation/);
});

test('supabase provider maps all smart module entities', () => {
  const source = fs.readFileSync('src/data/providers/supabaseProvider.js', 'utf8');
  for (const entity of ['Conversation','Message','Opportunity','Automation','AutomationRun','IntelligenceInsight']) assert.match(source, new RegExp(`${entity}:`));
});

test('automation service records idempotent runs', () => {
  const source = fs.readFileSync('src/services/automationService.js', 'utf8');
  assert.match(source, /idempotency_key/);
  assert.match(source, /AutomationRun/);
});
