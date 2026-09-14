import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [path.resolve('supabase/functions/_shared/crmAutomation.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
const crm = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const migration = fs.readFileSync('supabase/migrations/0071_crm_automation_triggers.sql', 'utf8');
const accessMigration = fs.readFileSync('supabase/migrations/0072_crm_automation_worker_access.sql', 'utf8');
const worker = fs.readFileSync('supabase/functions/automation-worker/index.ts', 'utf8');
const page = fs.readFileSync('src/pages/Automacoes.jsx', 'utf8');
const labels = fs.readFileSync('src/lib/automations.js', 'utf8');

const activity = (due_at, extra = {}) => ({ id: 'activity-a', company_id: 'tenant-a', status: 'PENDENTE', due_at, ...extra });

test('migration preserva gatilhos antigos e libera somente os quatro CRM', () => {
  for (const value of ['new_sale', 'new_lead', 'quote_created', 'quote_approved', 'quote_no_response', 'stock_below_min', 'bill_due', 'bill_overdue', 'client_inactive', 'goal_reached', 'assistant_job_queued', 'crm_activity_due_soon', 'crm_activity_due_today', 'crm_activity_overdue', 'crm_opportunity_without_next_action']) assert.match(migration, new RegExp(`'${value}'`));
  assert.match(migration, /drop constraint if exists automations_trigger_type_check/);
  assert.match(migration, /add constraint automations_trigger_type_check check/i);
});

test('worker recebe apenas leitura server-side dos sinais CRM', () => {
  assert.match(accessMigration, /grant select on public\.crm_activities, public\.opportunities to service_role/i);
  assert.doesNotMatch(accessMigration, /authenticated|anon|insert|update|delete/i);
});

test('classificação CRM é determinística e não duplica hoje com próximas 24h', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  assert.equal(crm.isDueTodayActivity(activity('2026-09-13T18:00:00Z'), now, 'America/Cuiaba'), true);
  assert.equal(crm.isDueSoonActivity(activity('2026-09-13T18:00:00Z'), now, 'America/Cuiaba'), false);
  assert.equal(crm.isDueSoonActivity(activity('2026-09-14T11:00:00Z'), now, 'America/Cuiaba'), true);
  assert.equal(crm.isOverdueActivity(activity('2026-09-12T12:00:00Z'), now), true);
  assert.equal(crm.isOverdueActivity(activity('2026-09-12T12:00:00Z', { status: 'CONCLUIDA' }), now), false);
});

test('timezone usa dia local e chave muda quando o follow-up é reagendado', () => {
  const now = new Date('2026-09-14T02:30:00Z');
  assert.equal(crm.localDateKey(now, 'America/Cuiaba'), '2026-09-13');
  const first = crm.signalWindowKey({ activity_id: 'a1', due_at: '2026-09-14T13:00:00Z' }, 'crm_activity_due_soon', 'UTC');
  const second = crm.signalWindowKey({ activity_id: 'a1', due_at: '2026-09-15T13:00:00Z' }, 'crm_activity_due_soon', 'UTC');
  assert.notEqual(first, second);
});

test('worker processa em lote, usa company_id, entitlement e deduplicação existentes', () => {
  assert.match(worker, /from\('crm_activities'\)/);
  assert.match(worker, /from\('opportunities'\)/);
  assert.match(worker, /company_has_feature/);
  assert.match(worker, /automation_runs/);
  assert.match(worker, /CRM_AUTOMATION_DUPLICATE_SKIPPED/);
  assert.match(worker, /assigned_to/);
  assert.doesNotMatch(worker, /openai|anthropic|whatsapp-send|billing-checkout/i);
});

test('Automations expõe a categoria de follow-ups sem criar UI paralela', () => {
  for (const label of ['Atividade vencendo', 'Atividade de hoje', 'Atividade atrasada', 'Oportunidade sem próxima ação']) assert.match(labels, new RegExp(label));
  assert.match(page, /Follow-ups e tarefas comerciais/);
  assert.match(page, /trigger_type: trigger/);
  assert.match(page, /schedule_frequency/);
});
