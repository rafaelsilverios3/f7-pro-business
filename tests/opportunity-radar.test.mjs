import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRadarRisk, RADAR_RISK_LABELS } from '../src/lib/opportunityRadar.js';
import fs from 'node:fs';
const permissions = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');
test('radar classifica risco sem acusar fraude', () => { assert.equal(classifyRadarRisk({ trustScore: 80, confidence: 80, signalCount: 2 }), RADAR_RISK_LABELS.LOW); assert.equal(classifyRadarRisk({ trustScore: 20, confidence: 80, signalCount: 2 }), RADAR_RISK_LABELS.HIGH); assert.equal(classifyRadarRisk({ trustScore: 90, confidence: 10, signalCount: 2 }), RADAR_RISK_LABELS.UNKNOWN); });
test('radar possui permissão específica', () => { assert.match(permissions, /opportunity_radar\.view/); assert.match(permissions, /opportunity_radar\.manage/); });
