import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync('supabase/functions/_shared/conversationIntent.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const intent = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('assistant-suggest keeps the newest part request active across a follow-up', () => {
  const first = intent.resolveConversationIntent([
    { id: 'm2', sender_type: 'customer', content: 'Preciso do filtro de combustível do John Deere 7230J' },
    { id: 'm1', sender_type: 'customer', content: 'Boa tarde' },
  ]);
  const second = intent.resolveConversationIntent([
    { id: 'm4', sender_type: 'customer', content: 'Agora preciso do filtro de óleo do motor' },
    { id: 'm3', sender_type: 'agent', content: 'Vou verificar o filtro de combustível.' },
    { id: 'm2', sender_type: 'customer', content: 'Preciso do filtro de combustível do John Deere 7230J' },
  ], first.activeIntent);

  assert.equal(second.latestCustomerMessage.id, 'm4');
  assert.equal(second.currentRequest, 'filtro de óleo');
  assert.equal(second.activeIntent.model, '7230J');
  assert.equal(second.intentChanged, true);
  for (const invalidated of ['old_candidates', 'selected_candidate', 'research_results', 'ranking', 'application', 'confidence', 'recommendation', 'pending_question']) assert.ok(second.invalidations.includes(invalidated));
  const query = intent.buildResearchQuery(second, 'brazil');
  assert.match(query, /filtro de óleo/);
  assert.doesNotMatch(query, /combustível/);
  assert.match(intent.researchCacheKey({ company_id: 'company-1', manufacturer: 'John Deere', model: '7230J', requested_part: second.currentRequest, region: 'brazil', strategy_version: 'v2' }), /company-1\|john deere\|7230j\|filtro de oleo\|brazil\|v2/);
});

test('assistant-suggest keeps compatible history without allowing it to replace the current request', () => {
  const result = intent.resolveConversationIntent([
    { id: 'm6', sender_type: 'customer', content: 'Qual o preço?' },
    { id: 'm5', sender_type: 'customer', content: 'Filtro de óleo para o John Deere 7230J' },
  ], { manufacturer: 'John Deere', model: '7230J', requestedPart: 'filtro de óleo', normalizedRequestedPart: 'filtro de oleo' });
  assert.equal(result.currentRequest, 'filtro de óleo');
  assert.equal(result.intentChanged, false);
  assert.equal(result.conversationHistory[0].content, 'Filtro de óleo para o John Deere 7230J');
});
