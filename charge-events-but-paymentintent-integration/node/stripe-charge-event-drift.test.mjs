import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-charge-event-drift.mjs';

test('charge only while intents fire is stale', () => {
  const [state, detail] = verdict(['charge.succeeded'], ['payment_intent.succeeded']);
  assert.equal(state, 'stale');
  assert.match(detail, /client_reference_id/);
});

test('the same config with no modern traffic is a real charges integration', () => {
  assert.equal(verdict(['charge.succeeded'], [])[0], 'legacy');
});

test('subscribing to both is double fulfilment', () => {
  const [state, detail] = verdict(
    ['charge.succeeded', 'payment_intent.succeeded'], ['payment_intent.succeeded']);
  assert.equal(state, 'overlapping');
  assert.match(detail, /twice/);
});

test('checkout sessions firing with no session subscription', () => {
  const [state] = verdict(['payment_intent.succeeded'],
    ['payment_intent.succeeded', 'checkout.session.completed']);
  assert.equal(state, 'checkout-gap');
});

test('a matching subscription is aligned', () => {
  const [state] = verdict(['payment_intent.succeeded', 'checkout.session.completed'],
    ['payment_intent.succeeded', 'checkout.session.completed']);
  assert.equal(state, 'aligned');
});

test('a wildcard is called out rather than passed', () => {
  assert.equal(verdict(['*'], ['payment_intent.succeeded'])[0], 'wildcard');
});
