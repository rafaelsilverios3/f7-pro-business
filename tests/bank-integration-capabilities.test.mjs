import test from 'node:test';
import assert from 'node:assert/strict';
import { getBankIntegrationCapabilities } from '../src/lib/bankIntegrationCapabilities.js';

test('manual bank entry remains available without pretending an automatic connector exists', () => {
  const capabilities = getBankIntegrationCapabilities();
  assert.equal(capabilities.find((item) => item.id === 'manual').available, true);
  assert.equal(capabilities.find((item) => item.id === 'mercado_pago_connect').available, false);
  assert.match(capabilities.find((item) => item.id === 'mercado_pago_connect').reason, /assinatura F7/);
  assert.equal(capabilities.find((item) => item.id === 'open_finance').available, false);
  assert.equal(capabilities.find((item) => item.id === 'statement_import').available, false);
});

test('tenant Mercado Pago capability is available only after explicit company OAuth connection', () => {
  const capabilities = getBankIntegrationCapabilities({ connectedProviders: ['mercado_pago_connect'] });
  assert.equal(capabilities.find((item) => item.id === 'mercado_pago_connect').available, true);
});
