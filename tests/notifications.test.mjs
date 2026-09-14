import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { notificationCategory, notificationRoute } from '../src/lib/notificationPresentation.js';

const service = fs.readFileSync('src/services/notificationsService.js', 'utf8');
const page = fs.readFileSync('src/pages/Notificacoes.jsx', 'utf8');
const layout = fs.readFileSync('src/components/layout/Layout.jsx', 'utf8');
const bell = fs.readFileSync('src/components/layout/NotificationBell.jsx', 'utf8');

test('notification routing is allowlisted and ignores arbitrary metadata URLs', () => {
  assert.equal(notificationRoute({ entity: 'crm_activity', entity_id: 'activity-1', metadata: { url: 'https://evil.example' } }), '/sales-hub?activity=activity-1');
  assert.equal(notificationRoute({ entity: 'opportunity', entity_id: 'opp-1' }), '/sales-hub?opportunity=opp-1');
  assert.equal(notificationRoute({ type: 'automation' }), '/automacoes');
  assert.equal(notificationRoute({ entity: 'unknown', entity_id: 'x', metadata: { url: 'https://evil.example' } }), null);
});

test('notification categories preserve CRM and automation origins', () => {
  assert.equal(notificationCategory({ entity: 'crm_activity', type: 'automation' }), 'CRM');
  assert.equal(notificationCategory({ type: 'automation' }), 'Automações');
  assert.equal(notificationCategory({ type: 'radar' }), 'Oportunidades');
  assert.equal(notificationCategory({ type: 'something_new' }), 'Sistema');
});

test('notifications service uses persistent read state, count query and tenant/user scope', () => {
  assert.match(service, /countUnread/);
  assert.match(service, /select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(service, /eq\('company_id', companyId\)/g);
  assert.match(service, /user_id\.is\.null,user_id\.eq/);
  assert.match(service, /update\(\{ read: true \}\)/);
  assert.doesNotMatch(service, /localStorage/);
});

test('central supports unread/read filters, mark-all, pagination and safe fallback states', () => {
  for (const token of ['Todas', 'Não lidas', 'Lidas', 'Marcar todas como lidas', 'Tentar novamente', 'result.hasMore']) assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(page, /notificationRoute/);
  assert.doesNotMatch(page, /Trash2|handleDelete/);
});

test('header badge and dropdown share the notifications service', () => {
  assert.match(layout, /notificationsService\.countUnread/);
  assert.match(layout, /NotificationBell/);
  assert.match(bell, /aria-label={`Notificações/);
  assert.match(bell, /Ver todas/);
  assert.match(bell, /Escape/);
});

test('CRM deep links highlight context without marking the entity resolved', () => {
  const salesHub = fs.readFileSync('src/pages/SalesHub.jsx', 'utf8');
  assert.match(salesHub, /useSearchParams/);
  assert.match(salesHub, /highlightActivityId/);
  assert.match(salesHub, /crm-activity-/);
  assert.match(salesHub, /highlightOpportunityId/);
});
