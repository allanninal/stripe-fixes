import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-payment-failure-events.mjs';

test('success subscribed without the failure is one sided', () => {
  const [state, detail] = verdict(['payment_intent.succeeded'], false, 0);
  assert.equal(state, 'one-sided');
  assert.match(detail, /payment_intent\.payment_failed/);
});

test('active subscriptions with failures already seen is an incident', () => {
  const [state, detail] = verdict(
    ['payment_intent.succeeded', 'payment_intent.payment_failed'], true, 9);
  assert.equal(state, 'blind');
  assert.match(detail, /9 invoice/);
});

test('no subscriptions means the invoice event is not required', () => {
  const [state] = verdict(
    ['payment_intent.succeeded', 'payment_intent.payment_failed'], false, 0);
  assert.equal(state, 'covered');
});

test('both surfaces missing is reported as one finding', () => {
  const [state] = verdict(['payment_intent.succeeded', 'invoice.paid'], true, 0);
  assert.equal(state, 'exposed');
});

test('an account with no payment events at all', () => {
  assert.equal(verdict(['customer.created'], false, 0)[0], 'no-payment-events');
});

test('a wildcard covers both surfaces', () => {
  assert.equal(verdict(['*'], true, 40)[0], 'wildcard');
});
