import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { meliNotificationProcessingEnabled, schedulerPolicy } from '../supabase/functions/_shared/schedulerPolicy.js';

const read = (path) => fs.readFileSync(path, 'utf8');

test('scheduled work is disabled by default and requires an explicit master switch', () => {
  assert.deepEqual(schedulerPolicy({}), { enabled: false, automations: false, meliRecovery: false });
  assert.deepEqual(schedulerPolicy({ F7_AUTOMATION_SCHEDULER_ENABLED: 'true', F7_MELI_QUEUE_RECOVERY_ENABLED: 'true' }), { enabled: false, automations: false, meliRecovery: false });
  assert.deepEqual(schedulerPolicy({ F7_SCHEDULER_ENABLED: 'true' }), { enabled: true, automations: false, meliRecovery: false });
});

test('automation scheduling and Mercado Livre queue recovery can be enabled independently', () => {
  assert.deepEqual(schedulerPolicy({ F7_SCHEDULER_ENABLED: 'true', F7_AUTOMATION_SCHEDULER_ENABLED: 'true' }), { enabled: true, automations: true, meliRecovery: false });
  assert.deepEqual(schedulerPolicy({ F7_SCHEDULER_ENABLED: 'true', F7_MELI_QUEUE_RECOVERY_ENABLED: 'true' }), { enabled: true, automations: false, meliRecovery: true });
});

test('Mercado Livre queue processing requires its own explicit opt-in', () => {
  assert.equal(meliNotificationProcessingEnabled({}), false);
  assert.equal(meliNotificationProcessingEnabled({ F7_MELI_QUEUE_PROCESSING_ENABLED: 'false' }), false);
  assert.equal(meliNotificationProcessingEnabled({ F7_MELI_QUEUE_PROCESSING_ENABLED: 'true' }), true);
  const worker = read('supabase/functions/mercadolivre-notification-worker/index.ts');
  assert.match(worker, /hasInternalServiceAuthorization/);
  assert.match(worker, /MELI_QUEUE_PROCESSING_DISABLED/);
  assert.ok(worker.indexOf('MELI_QUEUE_PROCESSING_DISABLED') < worker.indexOf('meli_claim_notification_batch'));
});

test('scheduler checks internal auth and disabled policy before creating a database client or dispatching work', () => {
  const source = read('supabase/functions/automation-scheduler/index.ts');
  const authAt = source.indexOf('if (!validSchedulerRequest(req))');
  const policyAt = source.indexOf('schedulerPolicy({');
  const disabledAt = source.indexOf("code: 'SCHEDULER_DISABLED'");
  const adminAt = source.indexOf('const sb = admin()');
  const dispatchAt = source.indexOf('if (policy.meliRecovery) dispatchMeliNotificationSweep()');
  assert.ok(authAt >= 0 && authAt < policyAt);
  assert.ok(policyAt < disabledAt && disabledAt < dispatchAt && disabledAt < adminAt);
  assert.match(source, /if \(policy\.meliRecovery\) dispatchMeliNotificationSweep\(\)/);
  assert.match(source, /if \(!policy\.automations\) return/);
});

test('admin-facing AI observability validates active tenant membership and fails closed on lookup errors', () => {
  for (const path of ['supabase/functions/ai-run-inspector/index.ts', 'supabase/functions/platform-health/index.ts']) {
    const source = read(path);
    assert.match(source, /auth\.getUser\(token\)/);
    assert.match(source, /COMPANY_CONTEXT_REQUIRED/);
    assert.match(source, /\.eq\('active', true\)/);
    assert.match(source, /COMPANY_MEMBERSHIP_LOOKUP_FAILED/);
    assert.match(source, /!membership\.data/);
    assert.match(source, /admin.*gestor/);
  }
  assert.match(read('supabase/functions/platform-health/index.ts'), /HEALTH_SNAPSHOT_WRITE_FAILED/);
  assert.match(read('supabase/config.toml'), /\[functions\.ai-run-inspector\][\s\S]*?verify_jwt = true/);
  assert.match(read('supabase/config.toml'), /\[functions\.platform-health\][\s\S]*?verify_jwt = true/);
});

test('public billing plan endpoint returns only catalog fields and fails closed if features cannot load', () => {
  const source = read('supabase/functions/billing-plans/index.ts');
  assert.match(source, /select\('id,code,name,description,price_minor,currency,billing_period,trial_days,highlighted,sort_order'\)/);
  assert.match(source, /select\('plan_id,feature,enabled,usage_limit'\)/);
  assert.match(source, /if \(featureResult\.error\) return json\(\{ code: 'BILLING_PLANS_UNAVAILABLE' \}, 500\)/);
  assert.doesNotMatch(source, /MERCADO_PAGO_ACCESS_TOKEN|MERCADO_PAGO_WEBHOOK_SECRET|service_role_key/i);
  assert.match(read('supabase/config.toml'), /\[functions\.billing-plans\][\s\S]*?verify_jwt = false/);
});

test('Preview build explicitly rejects both known production backend projects', () => {
  const source = read('vite.config.js');
  assert.match(source, /process\.env\.VERCEL_ENV === 'preview'/);
  assert.match(source, /izakmtgezocbneilopwr/);
  assert.match(source, /vwylnjmapixtzhryiutt/);
  assert.match(source, /Preview deployments may not target either protected F7 Supabase project/);
});
