import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateMarketOpportunityScore, combineMarketSignals, dataAvailability } from '../src/lib/marketScoring.js';

const migration = fs.readFileSync(new URL('../supabase/migrations/0026_market_intelligence.sql', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');

test('score de mercado exige múltiplos sinais', () => {
  assert.equal(calculateMarketOpportunityScore({ search_volume: 90 }), null);
  assert.equal(calculateMarketOpportunityScore({ search_volume: 90, growth: 80 }), 85);
  assert.deepEqual(combineMarketSignals([{ signal_type: 'growth', value: 80 }, { signal_type: 'growth', value: 60 }]).growth, 70);
});

test('dados sem fonte ficam indisponíveis', () => {
  assert.equal(dataAvailability([]), 'indisponível');
  assert.equal(dataAvailability([{ source: 'manual' }]), 'parcial');
});

test('migration mantém mercado separado do estoque e isolado por empresa', () => {
  assert.match(migration, /market_sources/);
  assert.match(migration, /market_signals/);
  assert.match(migration, /market_opportunities/);
  assert.match(migration, /current_company_role\(company_id\)/);
  assert.doesNotMatch(migration, /alter table public\.products/);
  assert.match(migration, /market_signals_company_source_fk/);
  assert.match(migration, /validate_market_opportunity_sources/);
});

test('migration torna checks e fontes idempotentes e preserva validações', () => {
  assert.match(migration, /alter table public\.market_sources drop constraint if exists market_sources_confidence_check/);
  assert.match(migration, /alter table public\.market_signals drop constraint if exists market_signals_confidence_check/);
  assert.match(migration, /alter table public\.market_opportunities drop constraint if exists market_opportunities_scores_check/);
  assert.match(migration, /confidence is null or confidence between 0 and 100/);
  assert.match(migration, /opportunity_score is null or opportunity_score between 0 and 100/);
  assert.match(migration, /trust_score is null or trust_score between 0 and 100/);
  assert.match(migration, /estimated_capital is null or estimated_capital >= 0/);
  assert.match(migration, /foreign key \(company_id, source_id\) references public\.market_sources\(company_id, id\)/);
  assert.match(migration, /validate_market_opportunity_sources/);
  assert.match(migration, /id = source_id and company_id = new\.company_id/);
});

test('permissões de Market Intelligence são separadas', () => {
  assert.match(permissions, /market_intelligence\.view/);
  assert.match(permissions, /market_intelligence\.manage/);
});

