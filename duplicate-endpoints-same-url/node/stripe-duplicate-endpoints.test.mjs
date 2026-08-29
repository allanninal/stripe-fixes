import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, verdict } from './stripe-duplicate-endpoints.mjs';

test('query string does not make a new destination', () => {
  // Stripe's version-upgrade guide tells you to add exactly this parameter.
  assert.equal(
    normalise('https://example.com/stripe/webhook?v=2025-09-30'),
    normalise('https://example.com/stripe/webhook'));
});

test('trailing slash and host case are ignored', () => {
  assert.equal(
    normalise('https://Example.COM/stripe/webhook/'),
    normalise('https://example.com/stripe/webhook'));
});

test('different paths stay different', () => {
  assert.notEqual(normalise('https://example.com/a'),
                  normalise('https://example.com/b'));
});

test('two enabled endpoints on one url is the finding', () => {
  const [state, detail] = verdict([{ status: 'enabled' }, { status: 'enabled' }]);
  assert.equal(state, 'duplicate');
  assert.match(detail, /2 times/);
});

test('one enabled beside a disabled one is only residue', () => {
  assert.equal(verdict([{ status: 'enabled' }, { status: 'disabled' }])[0], 'residue');
});

test('a single endpoint is unique', () => {
  assert.equal(verdict([{ status: 'enabled' }])[0], 'unique');
});
