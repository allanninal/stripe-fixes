import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-refund-health.mjs';

const NOW = 1800000000;
const DAY = 86400;

test('dead card is reported as unretryable', () => {
  const [state, detail] = classify(
    { status: 'failed', failure_reason: 'expired_or_canceled_card' }, NOW);
  assert.equal(state, 'failed');
  assert.match(detail, /out of band/);
});

test('other failures say the money reached nobody', () => {
  const [state, detail] = classify(
    { status: 'failed', failure_reason: 'insufficient_funds' }, NOW);
  assert.equal(state, 'failed');
  assert.match(detail, /reached nobody/);
});

test('requires_action is not a failure', () => {
  const [state, detail] = classify({ status: 'requires_action' }, NOW);
  assert.equal(state, 'needs-action');
  assert.match(detail, /next_action/);
});

test('pending inside the window is normal', () => {
  assert.equal(classify({ status: 'pending', created: NOW - 3 * DAY }, NOW)[0], 'pending');
});

test('long pending is stalled and unknown status is not settled', () => {
  const [state, detail] = classify(
    { status: 'pending', created: NOW - 30 * DAY, pending_reason: 'charge_pending' }, NOW);
  assert.equal(state, 'stalled');
  assert.match(detail, /charge_pending/);
  // A status Stripe adds later must not be read as money delivered.
  assert.equal(classify({ status: 'reversed' }, NOW)[0], 'unknown');
});
