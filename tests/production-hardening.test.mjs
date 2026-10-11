import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('CI validates application, Edge bundles, migrations and frontend secret boundary', () => {
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  for (const command of ['npm ci','npm test','typecheck:strict','typecheck','lint','build','validate-edge-functions','validate-migrations','validate-frontend-secrets']) assert.match(ci, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('production readiness records every required dimension and manual blockers', () => {
  const document = fs.readFileSync('docs/PRODUCTION_READINESS.md', 'utf8');
  for (const dimension of ['AUTH','SECURITY','RLS','MULTITENANCY','AI','RESEARCH','AUTO_REPLY','OBSERVABILITY','COST','INTEGRATIONS','TESTING','FAILOVER']) assert.match(document, new RegExp(`\\| ${dimension} \\|`));
  assert.match(document, /0042.*0046/s);
  assert.match(document, /DEPLOY REQUIRED/);
  assert.match(document, /74\/100/);
});

test('master directive documentation set is complete', () => {
  for (const file of ['MASTER_AUDIT.md','MASTER_PLAN.md','AI_ARCHITECTURE.md','AUTONOMOUS_AGENT.md','RESEARCH_ENGINE.md','SPECIALISTS.md','PARTS_INTELLIGENCE.md','AI_SECURITY.md','AI_OBSERVABILITY.md','AI_COSTS.md','PRODUCTION_READINESS.md']) {
    assert.ok(fs.existsSync(`docs/${file}`), `${file} must exist`);
  }
});

test('production scripts reject unsafe migration and frontend patterns', () => {
  const migrations = fs.readFileSync('scripts/validate-migrations.mjs', 'utf8');
  const secrets = fs.readFileSync('scripts/validate-frontend-secrets.mjs', 'utf8');
  assert.match(migrations, /\\d\{14\}/, 'migration validator must support the canonical timestamp version recorded by Supabase');
  assert.match(migrations, /Duplicate migration number/);
  assert.match(migrations, /RLS cannot be disabled/);
  assert.match(migrations, /broad browser grant/);
  for (const secret of ['SUPABASE_SERVICE_ROLE_KEY','WHATSAPP_ACCESS_TOKEN','AI_API_KEY','WEB_SEARCH_API_KEY']) assert.match(secrets, new RegExp(secret));
});
