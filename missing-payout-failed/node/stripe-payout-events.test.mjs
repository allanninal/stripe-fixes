import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-payout-events.mjs';

const BOTH = ['payout.paid', 'payout.failed', 'payment_intent.succeeded'];

test('both payout events subscribed is covered', () => {
  assert.equal(verdict(BOTH, 0)[0], 'covered');
});

test('missing subscription with failures is an incident', () => {
  const [state, detail] = verdict(['payout.paid'], 3);
  assert.equal(state, 'blind');
  assert.match(detail, /3 payout\(s\)/);
});

test('missing subscription with no failures is only a gap', () => {
  // Same configuration, different urgency.
  assert.equal(verdict(['payout.paid'], 0)[0], 'unsubscribed');
});

test('failure without the success is flagged as partial', () => {
  assert.equal(verdict(['payout.failed'], 0)[0], 'partial');
});

test('a wildcard covers it but is named as such', () => {
  const [state, detail] = verdict(['*'], 0);
  assert.equal(state, 'wildcard');
  assert.match(detail, /every/);
});
