import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateOpportunityScore, normalizeScores, OPPORTUNITY_STATUSES } from '../src/lib/opportunityScoring.js';

const migration = fs.readFileSync(new URL('../supabase/migrations/0024_opportunity_foundation.sql', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');

test('estados e scores de oportunidade são normalizados', () => {
  assert.equal(OPPORTUNITY_STATUSES.DISCOVERY, 'descoberta');
  assert.equal(OPPORTUNITY_STATUSES.CONVERTED, 'convertida_em_produto');
  assert.equal(calculateOpportunityScore({ demand: 100, growth: 80 }), 18);
  assert.equal(normalizeScores({ demand: 180 }).demand, 100);
});

test('migration isola oportunidades e rascunhos por empresa', () => {
  assert.match(migration, /product_opportunities/);
  assert.match(migration, /opportunity_product_drafts/);
  assert.match(migration, /supplier_score/);
  assert.match(migration, /trust_score/);
  assert.match(migration, /channel_score/);
  assert.match(migration, /current_company_role\(company_id\)/);
  assert.match(migration, /active boolean not null default false/);
});

test('permissões do Opportunity não concedem acesso a estoque automaticamente', () => {
  assert.match(permissions, /opportunity\.view/);
  assert.match(permissions, /opportunity\.manage/);
  assert.match(permissions, /opportunity\.promote/);
  assert.match(permissions, /vendedor:[^\n]+opportunity\.view/);
  assert.doesNotMatch(permissions, /financeiro:[^\n]+opportunity\.manage/);
});
