import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intentOf, verdict } from './stripe-sca-stuck-subs.mjs';

const legacy = (payment_intent) => ({
  id: 'sub_1', status: 'incomplete',
  latest_invoice: { id: 'in_1', payment_intent },
});

const basil = (intent) => ({
  id: 'sub_1', status: 'incomplete',
  latest_invoice: { id: 'in_1', payments: { data: [{ payment: { payment_intent: intent } }] } },
});

test('an unanswered challenge is named as one', () => {
  const [state, detail] = verdict(
    legacy({ status: 'requires_action', next_action: { type: 'use_stripe_sdk' } }));
  assert.equal(state, 'authentication');
  assert.match(detail, /use_stripe_sdk/);
  assert.match(detail, /still live/);
});

test('the intent is found on the basil shape too', () => {
  const intent = { status: 'requires_action', next_action: { type: 'redirect_to_url' } };
  assert.deepEqual(intentOf(basil(intent).latest_invoice), intent);
  assert.equal(verdict(basil(intent))[0], 'authentication');
});

test('a declined card is not reported as an authentication problem', () => {
  const [state, detail] = verdict(legacy({
    status: 'requires_payment_method',
    last_payment_error: { decline_code: 'insufficient_funds' },
  }));
  assert.equal(state, 'declined');
  assert.match(detail, /insufficient_funds/);
});

test('an unreadable invoice is not a healthy one', () => {
  const [state, detail] = verdict({ id: 'sub_1', status: 'incomplete', latest_invoice: 'in_1' });
  assert.equal(state, 'unexpanded');
  assert.match(detail, /basil/);
});

test('requires_action with nothing to do is its own state', () => {
  assert.equal(verdict(legacy({ status: 'requires_action' }))[0], 'no-next-action');
});
