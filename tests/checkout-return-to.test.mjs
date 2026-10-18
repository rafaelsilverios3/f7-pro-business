import test from 'node:test';
import assert from 'node:assert/strict';
import { emailConfirmationRedirect, resolveSafeReturnTo } from '../src/lib/authReturnTo.js';

const previewOrigin = 'https://f7-pro-business-preview.example.vercel.app';

test('same-origin checkout plan survives the login and e-mail confirmation return route', () => {
  const selectedPlan = '/checkout?plan=business';
  const redirect = new URL(emailConfirmationRedirect(previewOrigin, selectedPlan));
  assert.equal(redirect.origin, previewOrigin);
  assert.equal(redirect.pathname, '/login');
  assert.equal(redirect.searchParams.get('returnTo'), selectedPlan);
  assert.equal(resolveSafeReturnTo(redirect.searchParams.get('returnTo'), previewOrigin), selectedPlan);
});

test('return route rejects external and parser-normalized open redirects', () => {
  for (const value of ['https://attacker.invalid', '//attacker.invalid', '/.//attacker.invalid', '/\\\\attacker.invalid']) {
    assert.equal(resolveSafeReturnTo(value, previewOrigin), '/f7probusiness');
  }
});

test('return route strips auth bootstrap parameters but preserves plan context', () => {
  const safe = resolveSafeReturnTo('/checkout?plan=pro&access_token=secret&app_id=bad', previewOrigin);
  assert.equal(safe, '/checkout?plan=pro');
  assert.doesNotMatch(safe, /secret|access_token|app_id/);
});

test('confirmation redirect accepts only http(s) origin and always targets local login', () => {
  assert.throws(() => emailConfirmationRedirect('javascript:alert(1)', '/checkout?plan=pro'), /INVALID_AUTH_ORIGIN/);
  const redirect = new URL(emailConfirmationRedirect(previewOrigin, 'https://attacker.invalid'));
  assert.equal(redirect.origin, previewOrigin);
  assert.equal(redirect.pathname, '/login');
  assert.equal(redirect.searchParams.get('returnTo'), '/f7probusiness');
});
