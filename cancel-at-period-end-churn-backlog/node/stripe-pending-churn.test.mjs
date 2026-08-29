import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduledEnd, verdict } from './stripe-pending-churn.mjs';

test('an imminent cliff outranks a low rate', () => {
  // One cancellation in three days beats fifty spread over a year.
  const [state, detail] = verdict(1, 400, 3);
  assert.equal(state, 'imminent');
  assert.match(detail, /3 day/);
});

test('a high rate far out is a trend', () => {
  assert.equal(verdict(60, 400, 200)[0], 'elevated');
});

test('a handful far out is just a backlog', () => {
  const [state, detail] = verdict(8, 400, 200);
  assert.equal(state, 'backlog');
  assert.match(detail, /2.0%/);
});

test('no active subscriptions is not a clean bill of health', () => {
  assert.equal(verdict(0, 0, null)[0], 'empty');
});

test('the end date comes from the item not from canceled_at', () => {
  const sub = {
    cancel_at_period_end: true,
    canceled_at: 1,
    items: { data: [{ current_period_end: 999 }] },
  };
  assert.equal(scheduledEnd(sub), 999);
  assert.equal(scheduledEnd({ cancel_at_period_end: false, canceled_at: 1 }), null);
});
