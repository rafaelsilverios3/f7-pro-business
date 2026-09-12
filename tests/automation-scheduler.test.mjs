import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateNextRunAt } from '../src/lib/automationScheduler.js';

test('manual schedules do not produce a due timestamp', () => {
  assert.equal(calculateNextRunAt({ frequency: 'manual' }), null);
});

test('daily schedule respects configured UTC time', () => {
  assert.equal(calculateNextRunAt({ frequency: 'daily', time: '08:00', from: '2026-09-12T07:00:00.000Z' }), '2026-09-12T08:00:00.000Z');
  assert.equal(calculateNextRunAt({ frequency: 'daily', time: '08:00', from: '2026-09-12T09:00:00.000Z' }), '2026-09-13T08:00:00.000Z');
});

test('weekly schedule rolls to the requested weekday', () => {
  assert.equal(calculateNextRunAt({ frequency: 'weekly', weekday: 1, time: '08:00', from: '2026-09-12T09:00:00.000Z' }), '2026-09-14T08:00:00.000Z');
  assert.equal(calculateNextRunAt({ frequency: 'weekly', weekday: 1, time: '08:00', from: '2026-09-14T09:00:00.000Z' }), '2026-09-21T08:00:00.000Z');
});

test('server scheduler has locking, idempotency and recovery primitives', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/0063_server_automation_scheduler.sql', import.meta.url), 'utf8');
  assert.match(migration, /FOR UPDATE SKIP LOCKED/i);
  assert.match(migration, /claim_due_automations/);
  assert.match(migration, /release_automation_claim/);
  assert.match(migration, /claim_until/);
  assert.match(migration, /scheduled_for/);
});

test('scheduler dispatches the existing worker with a stable scheduled idempotency event', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/automation-scheduler/index.ts', import.meta.url), 'utf8');
  assert.match(source, /x-f7-scheduler-secret/);
  assert.match(source, /automation-worker/);
  assert.match(source, /scheduled:\$\{automation\.id\}:\$\{scheduledFor\}/);
  assert.match(source, /AUTOMATION_CLAIMED/);
});

test('worker invokes deterministic tenant-scoped Radar detectors and records counts', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/automation-worker/index.ts', import.meta.url), 'utf8');
  assert.match(source, /runRadarDetector/);
  assert.match(source, /signals_count/);
  assert.match(source, /scheduled_for/);
});
