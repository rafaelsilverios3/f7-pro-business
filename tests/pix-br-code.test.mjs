import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStaticPixPayload, crc16ccitt } from '../src/lib/pixBrCode.js';

test('CRC16-CCITT matches the published check vector', () => {
  assert.equal(crc16ccitt('123456789'), '29B1');
});

test('static Pix BR Code carries the fixed amount, merchant and transaction reference', () => {
  const payload = buildStaticPixPayload({ pixKey: 'rafael@example.com', receiver: 'F7 TESTE', city: 'CUIABA', amount: 0.1, txid: 'ORC-2026-000002' });
  assert.ok(payload.startsWith('000201010212'));
  assert.ok(payload.includes('BR.GOV.BCB.PIX'));
  assert.ok(payload.includes('rafael@example.com'));
  assert.ok(payload.includes('54040.10'));
  assert.ok(payload.includes('5802BR'));
  assert.ok(payload.includes('ORC-2026-000002'));
  const crcOffset = payload.lastIndexOf('6304');
  assert.notEqual(crcOffset, -1);
  assert.equal(payload.slice(crcOffset + 4), crc16ccitt(payload.slice(0, crcOffset + 4)));
});

test('static Pix BR Code rejects missing receiver data and invalid amount', () => {
  assert.throws(() => buildStaticPixPayload({ pixKey: 'key', receiver: '', city: 'CUIABA', amount: 5 }), /nome do recebedor/);
  assert.throws(() => buildStaticPixPayload({ pixKey: 'key', receiver: 'F7', city: '', amount: 5 }), /cidade/);
  assert.throws(() => buildStaticPixPayload({ pixKey: 'key', receiver: 'F7', city: 'CUIABA', amount: 0 }), /maior que zero/);
});
