import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-legacy-charges.mjs';

test('charge with an intent is modern', () => {
  assert.equal(classify({ payment_intent: 'pi_123', status: 'succeeded' })[0], 'modern');
});

test('absent payment_intent key is legacy, not modern', () => {
  const [state, detail] = classify({ status: 'succeeded' });
  assert.equal(state, 'legacy');
  assert.match(detail, /3D Secure/);
});

test('authentication_required is its own state', () => {
  const [state, detail] = classify({
    payment_intent: null,
    status: 'failed',
    outcome: { type: 'issuer_declined', reason: 'authentication_required' },
  });
  assert.equal(state, 'unauthenticated');
  assert.match(detail, /declines again/);
});

test('an ordinary decline is not blamed on the legacy API', () => {
  const [state, detail] = classify({
    payment_intent: null,
    status: 'failed',
    outcome: { type: 'issuer_declined', reason: 'insufficient_funds' },
  });
  assert.equal(state, 'legacy_declined');
  assert.match(detail, /insufficient_funds/);
});

test('unrecognised status is not silently counted as modern', () => {
  assert.equal(classify({ payment_intent: null, status: 'reversed' })[0], 'unknown');
});
