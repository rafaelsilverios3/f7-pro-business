import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FUTURE_TRAINING_GUIDES,
  TRAINING_GUIDES,
  TRAINING_VIDEOS,
  getTrainingVideo,
  validateTrainingVideoCatalog,
} from '../src/content/training/trainingContent.js';

test('official video catalog has the 13-item recording sequence without fake assets', () => {
  assert.equal(TRAINING_VIDEOS.length, 13);
  assert.deepEqual(TRAINING_VIDEOS.map((video) => video.sequence), Array.from({ length: 13 }, (_, index) => index + 1));
  assert.equal(TRAINING_VIDEOS[0].title, 'Conhecendo o F7 Business');
  assert.deepEqual(TRAINING_VIDEOS.slice(1).map((video) => video.moduleId), TRAINING_GUIDES.map((guide) => guide.id));
  for (const video of TRAINING_VIDEOS) {
    assert.equal(video.videoUrl, null);
    assert.equal(video.thumbnailUrl, null);
    assert.equal(video.captionUrl, null);
    assert.equal(video.duration, null);
    assert.equal(video.status, 'SCRIPT_READY');
    assert.equal(video.version, '1.0');
    assert.ok(video.objective);
    assert.ok(video.whereToFind);
    assert.ok(video.content.length > 0);
    assert.ok(video.whatHappensNext);
    assert.ok(video.tips.length > 0);
    assert.ok(video.script.narration);
    assert.ok(Array.isArray(video.script.screenAction));
    assert.ok(Array.isArray(video.script.highlight));
    assert.ok(Array.isArray(video.script.note));
    assert.ok(video.learningObjectives.length > 0);
  }
});

test('catalog validator rejects invalid routes, duplicate IDs and placeholder assets', () => {
  assert.deepEqual(validateTrainingVideoCatalog(), { valid: true, errors: [] });
  const invalid = { ...TRAINING_VIDEOS[1], id: TRAINING_VIDEOS[0].id, route: '/wrong', videoUrl: 'coming-soon.mp4' };
  const result = validateTrainingVideoCatalog([TRAINING_VIDEOS[0], invalid]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /duplicate/i.test(error)));
  assert.ok(result.errors.some((error) => /route/i.test(error)));
  assert.ok(result.errors.some((error) => /placeholder/i.test(error)));
});

test('Academia only renders a player for a real URL and keeps future training gated', () => {
  const page = fs.readFileSync(new URL('../src/pages/Academy.jsx', import.meta.url), 'utf8');
  assert.match(page, /currentVideo\?\.videoUrl &&/);
  assert.match(page, /<video className=/);
  assert.match(page, /currentVideo\.captionUrl/);
  assert.ok(FUTURE_TRAINING_GUIDES.every((guide) => guide.requiredFeature));
  assert.equal(getTrainingVideo('precificacao').videoUrl, null);
});
