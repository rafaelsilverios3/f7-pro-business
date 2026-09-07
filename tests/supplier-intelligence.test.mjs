import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateSupplierScore, trustLabel, TRUST_LABELS, RISK_SIGNAL_TYPES } from '../src/lib/supplierScoring.js';

const migration = fs.readFileSync(new URL('../supabase/migrations/0025_supplier_intelligence.sql', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');

test('Supplier Score e Trust Score usam linguagem de risco responsável', () => {
  assert.equal(calculateSupplierScore({ reputation: 80, history: 80, price: 70, delivery: 70, returns: 70, complaints: 70, consistency: 70 }), 73);
  assert.equal(trustLabel(80, 10), TRUST_LABELS.UNKNOWN);
  assert.equal(trustLabel(80, 80), TRUST_LABELS.LOW);
  assert.equal(trustLabel(20, 80), TRUST_LABELS.HIGH);
});

test('migration mantém perfis, avaliações e sinais isolados por empresa', () => {
  assert.match(migration, /supplier_intelligence_profiles/);
  assert.match(migration, /supplier_reviews/);
  assert.match(migration, /supplier_risk_signals/);
  assert.match(migration, /is_company_member\(company_id\)/);
  assert.match(migration, /needs_validation boolean not null default true/);
});

test('permissões e sinais suspeitos estão preparados sem declarar fraude', () => {
  assert.match(permissions, /supplier_intelligence\.view/);
  assert.match(permissions, /supplier_intelligence\.manage/);
  assert.ok(RISK_SIGNAL_TYPES.includes('counterfeit_signal'));
  assert.ok(RISK_SIGNAL_TYPES.includes('copied_listing'));
});
