import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, verdict } from './stripe-idempotency-keys.mjs';

test('stripe initiated events are not findings', () => {
  assert.equal(classify({ id: null, idempotency_key: null }), 'stripe');
  assert.equal(classify(null), 'stripe');
});

test('an api request without a key is the finding', () => {
  assert.equal(classify({ id: 'req_123', idempotency_key: null }), 'unkeyed');
});

test('an api request with a key is clean', () => {
  assert.equal(classify({ id: 'req_123', idempotency_key: '8f14e45f' }), 'keyed');
});

test('a bare string request is unreported not unkeyed', () => {
  assert.equal(classify('req_123'), 'unreported');
});

test('one unkeyed charge is already exposed', () => {
  const [state, detail] = verdict('payment_intent.created', 400, 1);
  assert.equal(state, 'exposed');
  assert.match(detail, /twice/);
  assert.equal(verdict('customer.created', 400, 1)[0], 'unkeyed');
  assert.equal(verdict('payment_intent.created', 400, 0)[0], 'keyed');
});
