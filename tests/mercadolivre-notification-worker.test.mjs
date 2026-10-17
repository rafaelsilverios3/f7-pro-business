import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { processMeliNotificationBatch } from '../supabase/functions/_shared/mercadolivreQueuePolicy.js';

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20261017090000_mercado_livre_notification_worker.sql');
const webhook = read('supabase/functions/mercadolivre-webhook/index.ts');
const worker = read('supabase/functions/mercadolivre-notification-worker/index.ts');
const api = read('supabase/functions/mercadolivre-api/index.ts');
const scheduler = read('supabase/functions/automation-scheduler/index.ts');
const config = read('supabase/config.toml');

const companyA = '11111111-1111-4111-8111-111111111111';
const companyB = '22222222-2222-4222-8222-222222222222';
const connectionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function event(overrides = {}) {
  return { id: crypto.randomUUID(), company_id: companyA, connection_id: connectionA,
    topic: 'items', resource_path: '/items/MLB12345678', attempts: 1, ...overrides };
}

function harness({ connection, failProcess, failLoad } = {}) {
  const settled = [];
  const processed = [];
  return {
    settled, processed,
    deps: {
      loadConnection: async (companyId, connectionId) => {
        if (failLoad) throw new Error('database details must not leak');
        return connection === undefined ? { id: connectionId, company_id: companyId, seller_id: '12345678', status: 'connected' } : connection;
      },
      resolveToken: async () => 'synthetic-token-never-sent',
      processEvent: async (row) => {
        processed.push(row.id);
        if (failProcess) throw new Error(failProcess);
      },
      settle: async (row, outcome, code) => { settled.push({ id: row.id, outcome, code }); return true; },
    },
  };
}

test('valid synthetic notification is processed and settled once without provider credentials', async () => {
  const row = event(); const h = harness();
  const result = await processMeliNotificationBatch([row], h.deps);
  assert.equal(result.processed, 1);
  assert.deepEqual(h.settled, [{ id: row.id, outcome: 'processed', code: null }]);
});

test('duplicate provider notification is unique per tenant and accepted duplicate wakes the worker', () => {
  assert.match(read('supabase/migrations/20261015233622_mercado_livre_connector_foundation.sql'), /unique \(company_id, dedupe_key\)/);
  assert.match(webhook, /if \(duplicate\)[\s\S]*?dispatchNotificationWorker\(\)/);
  assert.match(webhook, /dispatchNotificationWorker\(\)[\s\S]*?deduplicated: false/);
});

test('concurrent synthetic claims process disjoint items once; SQL claim uses row locks and leases', async () => {
  const rows = [event(), event(), event()];
  let available = [...rows];
  const claim = async () => {
    // Models the RPC's atomic SKIP LOCKED claim in a local concurrency test.
    const batch = available.splice(0, 2);
    await Promise.resolve();
    return batch;
  };
  const h = harness();
  const [left, right] = await Promise.all([
    claim().then((batch) => processMeliNotificationBatch(batch, h.deps)),
    claim().then((batch) => processMeliNotificationBatch(batch, h.deps)),
  ]);
  assert.equal(left.processed + right.processed, 3);
  assert.equal(new Set(h.processed).size, 3);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /add constraint meli_webhook_events_company_id_id_key unique \(company_id, id\)/i);
  assert.match(migration, /foreign key \(company_id, event_id\)[\s\S]*?references public\.meli_webhook_events\(company_id, id\)/i);
  assert.match(migration, /lease_expires_at = clock_timestamp\(\) \+ interval '5 minutes'/);
  assert.match(migration, /event\.claim_token = p_claim_token/);
});

test('cross-company or cross-connection claim is dead-lettered without resource processing', async () => {
  const row = event({ company_id: companyB });
  const h = harness({ connection: { id: connectionA, company_id: companyA, seller_id: '12345678', status: 'connected' } });
  const result = await processMeliNotificationBatch([row], h.deps);
  assert.equal(result.dead_letter, 1);
  assert.equal(h.processed.length, 0);
  assert.equal(h.settled[0].code, 'MELI_CONNECTION_NOT_CONNECTED');
});

test('transient failure schedules retry and a later claim can recover successfully', async () => {
  const row = event({ attempts: 1 });
  const first = harness({ failProcess: 'MELI_PROVIDER_UNAVAILABLE' });
  const retryResult = await processMeliNotificationBatch([row], first.deps);
  assert.equal(retryResult.retried, 1);
  assert.deepEqual(first.settled[0], { id: row.id, outcome: 'retry', code: 'MELI_PROVIDER_UNAVAILABLE' });
  const second = harness();
  const recovered = await processMeliNotificationBatch([{ ...row, attempts: 2 }], second.deps);
  assert.equal(recovered.processed, 1);
  assert.deepEqual(second.settled[0], { id: row.id, outcome: 'processed', code: null });
  assert.match(migration, /interval '30 seconds' \* power\(2, event_attempt - 1\)/);
});

test('permanent failures and exhausted retry count go to dead-letter', async () => {
  const permanentRow = event();
  const permanent = harness({ failProcess: 'MELI_RESOURCE_NOT_FOUND' });
  const permanentResult = await processMeliNotificationBatch([permanentRow], permanent.deps);
  assert.equal(permanentResult.dead_letter, 1);
  assert.equal(permanent.settled[0].code, 'MELI_RESOURCE_NOT_FOUND');
  const exhaustedRow = event({ attempts: 6 });
  const exhausted = harness({ failProcess: 'MELI_PROVIDER_UNAVAILABLE' });
  const exhaustedResult = await processMeliNotificationBatch([exhaustedRow], exhausted.deps);
  assert.equal(exhaustedResult.dead_letter, 1);
  assert.equal(exhausted.settled[0].code, 'MELI_PROVIDER_UNAVAILABLE');
  assert.match(migration, /MELI_RETRIES_EXHAUSTED/);
});

test('missing connection is dead-lettered while lookup failure is retryable', async () => {
  const missingRow = event();
  const missing = harness({ connection: null });
  const missingResult = await processMeliNotificationBatch([missingRow], missing.deps);
  assert.equal(missingResult.dead_letter, 1);
  assert.equal(missing.settled[0].code, 'MELI_CONNECTION_NOT_CONNECTED');

  const failedLookupRow = event();
  const failedLookup = harness({ failLoad: true });
  const lookupResult = await processMeliNotificationBatch([failedLookupRow], failedLookup.deps);
  assert.equal(lookupResult.retried, 1);
  assert.equal(failedLookup.settled[0].code, 'MELI_CONNECTION_LOOKUP_FAILED');
});

test('one event failure does not stop the rest of the claimed batch', async () => {
  const good = event(); const bad = event();
  const h = harness();
  h.deps.processEvent = async (row) => { if (row.id === bad.id) throw new Error('MELI_REQUEST_REJECTED'); h.processed.push(row.id); };
  const result = await processMeliNotificationBatch([good, bad], h.deps);
  assert.equal(result.processed, 1);
  assert.equal(result.dead_letter, 1);
  assert.equal(h.settled.length, 2);
});

test('manual recovery uses the same claim/settlement contract as the automatic worker', () => {
  assert.match(api, /meli_claim_notification_batch/);
  assert.match(api, /meli_finish_notification_event/);
  assert.match(api, /processClaimedMeliNotifications/);
  assert.match(worker, /meli_claim_notification_batch/);
  assert.match(worker, /meli_finish_notification_event/);
  assert.match(worker, /authorization.*Bearer \$\{serviceKey\}/i);
  assert.match(worker, /remaining_batches/);
  assert.match(config, /\[functions\.mercadolivre-notification-worker\]\s+verify_jwt = true/);
});

test('existing scheduler tick dispatches recovery sweep without changing queue ownership', () => {
  assert.match(scheduler, /mercadolivre-notification-worker/);
  assert.match(scheduler, /waitUntilEdgeTask\(task\)/);
  assert.match(read('supabase/functions/_shared/edgeRuntime.ts'), /runtime\.waitUntil\(task\)/);
});
