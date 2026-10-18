import test from 'node:test';
import assert from 'node:assert/strict';
import { getWhatsAppIntegrationState } from '../src/lib/whatsappIntegrationState.js';

test('server-enabled provider exposes the connect action before a number is linked', () => {
  assert.deepEqual(getWhatsAppIntegrationState({ provider_enabled: true }, null), {
    providerEnabled: true,
    connected: false,
    status: 'not_configured',
  });
});

test('server-disabled provider stays blocked', () => {
  assert.deepEqual(getWhatsAppIntegrationState({ provider_enabled: false }, null), {
    providerEnabled: false,
    connected: false,
    status: 'disabled',
  });
});

test('unknown server state is pending instead of being misreported as disabled', () => {
  assert.deepEqual(getWhatsAppIntegrationState(null, null), {
    providerEnabled: false,
    connected: false,
    status: 'pending',
  });
});

test('connected company integration remains represented as connected', () => {
  assert.deepEqual(getWhatsAppIntegrationState({ provider_enabled: true }, { status: 'connected' }), {
    providerEnabled: true,
    connected: true,
    status: 'connected',
  });
});
