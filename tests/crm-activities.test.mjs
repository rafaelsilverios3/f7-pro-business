import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activitySummary, deriveNextAction, isOverdue, validateActivityInput } from '../src/lib/crmActivities.js';

const migration = fs.readFileSync(new URL('../supabase/migrations/0070_crm_activities.sql', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/SalesHub.jsx', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/crmActivitiesService.js', import.meta.url), 'utf8');

const companyA = '00000000-0000-0000-0000-000000000001';
const companyB = '00000000-0000-0000-0000-000000000002';
const userA = '10000000-0000-0000-0000-000000000001';
const customerA = '20000000-0000-0000-0000-000000000001';

test('migration cria schema mínimo com RLS, estados e tipos controlados', () => {
  assert.match(migration, /create table if not exists public\.crm_activities/);
  assert.match(migration, /alter table public\.crm_activities enable row level security/);
  assert.match(migration, /status in \('PENDENTE','CONCLUIDA','CANCELADA'\)/);
  assert.match(migration, /activity_type in \('ligacao','whatsapp','email','reuniao','visita','proposta','retorno','tarefa','outro'\)/);
  assert.match(migration, /created_by = auth\.uid\(\)/);
  assert.match(migration, /assigned_to.*active/);
});

test('vínculos de cliente, oportunidade e responsável são tenant-safe', () => {
  assert.match(migration, /Cliente não pertence à empresa da atividade/);
  assert.match(migration, /Oportunidade não pertence à empresa da atividade/);
  assert.match(migration, /Responsável não é membro ativo da empresa/);
  assert.match(migration, /current_company_role\(company_id\) in \('admin', 'gestor', 'comercial'\)/);
});

test('operações do service cobrem ciclo persistente sem delete ou automação externa', () => {
  for (const operation of ['createActivity', 'updateActivity', 'completeActivity', 'cancelActivity', 'rescheduleActivity', 'listPendingActivities', 'listOverdueActivities', 'listCustomerActivities', 'listOpportunityActivities', 'listAssignedActivities']) assert.match(service, new RegExp(`async ${operation}`));
  assert.doesNotMatch(service, /whatsapp|email.*send|automation/);
});

test('valida título e tipo antes de persistir', () => {
  assert.throws(() => validateActivityInput({ activity_type: 'tarefa' }), /título/i);
  assert.throws(() => validateActivityInput({ title: 'x', activity_type: 'invalido' }), /tipo/i);
  assert.equal(validateActivityInput({ title: ' Retorno ', activity_type: 'retorno' }).title, 'Retorno');
});

test('atraso depende de PENDENTE + due_at passado e estados terminais não vazam', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  assert.equal(isOverdue({ status: 'PENDENTE', due_at: '2026-09-12T12:00:00Z' }, now), true);
  assert.equal(isOverdue({ status: 'CONCLUIDA', due_at: '2026-09-12T12:00:00Z' }, now), false);
  assert.deepEqual(activitySummary([{ status: 'PENDENTE', due_at: '2026-09-12T12:00:00Z' }, { status: 'CANCELADA', due_at: '2026-09-11T12:00:00Z' }], now), { total: 2, pending: 1, overdue: 1, due_today: 0, completed: 0, cancelled: 1 });
});

test('atividades derivam próxima ação sem cruzar tenant no modelo', () => {
  const activity = { id: 'a1', company_id: companyA, customer_id: customerA, created_by: userA, assigned_to: userA, activity_type: 'retorno', status: 'PENDENTE', title: 'Retornar proposta', due_at: '2026-09-12T12:00:00Z' };
  const scoped = [activity, { ...activity, id: 'a2', company_id: companyB }].filter((row) => row.company_id === companyA);
  assert.equal(scoped.length, 1);
  assert.equal(deriveNextAction(scoped).id, 'a1');
  assert.match(fs.readFileSync(new URL('../src/lib/salesHub.js', import.meta.url), 'utf8'), /scopedActivities\.filter/);
  assert.match(fs.readFileSync(new URL('../src/lib/salesHub.js', import.meta.url), 'utf8'), /overdue_activity/);
});

test('UI expõe minhas tarefas, registrar, concluir, adiar e cancelar', () => {
  for (const label of ['Minhas tarefas', 'Registrar atividade', 'Concluir', '+1 dia', 'Cancelar']) assert.match(page, new RegExp(label.replace('+', '\\+')));
  assert.match(page, /Nenhuma atividade concluída recentemente/);
  assert.match(page, /Nenhuma mensagem externa é enviada automaticamente/);
});
