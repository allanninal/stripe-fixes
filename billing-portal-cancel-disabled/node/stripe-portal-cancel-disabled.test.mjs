import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-portal-cancel-disabled.mjs';

const FULL = { id: 'bpc_1', features: {
  subscription_cancel: { enabled: true, mode: 'at_period_end',
                         cancellation_reason: { enabled: true } },
  payment_method_update: { enabled: true } } };
const NO_CANCEL = { id: 'bpc_2', features: {
  subscription_cancel: { enabled: false },
  payment_method_update: { enabled: true } } };

test('a portal that cancels and asks why is done', () => {
  const [state, detail] = verdict(FULL, 0, 40);
  assert.equal(state, 'self-serve');
  assert.match(detail, /at_period_end/);
});

test('cancellation off with no disputes is still the finding', () => {
  const [state, detail] = verdict(NO_CANCEL, 0, 0);
  assert.equal(state, 'cancel-off');
  assert.match(detail, /their bank/);
});

test('cancellation off with disputes naming it is priced', () => {
  const [state, detail] = verdict(NO_CANCEL, 7, 42);
  assert.equal(state, 'cancel-off-disputed');
  assert.match(detail, /16\.7%/);
});

test('cancel on but card update off still sends people to support', () => {
  const config = { id: 'bpc_3', features: {
    subscription_cancel: { enabled: true, mode: 'immediately',
                           cancellation_reason: { enabled: true } },
    payment_method_update: { enabled: false } } };
  assert.equal(verdict(config)[0], 'update-off');
});

test('cancelling without asking why throws away the churn data', () => {
  const config = { id: 'bpc_4', features: {
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    payment_method_update: { enabled: true } } };
  const [state, detail] = verdict(config);
  assert.equal(state, 'no-reason');
  assert.match(detail, /at_period_end/);
});

test('a missing enabled flag is not read as off', () => {
  assert.equal(verdict({ id: 'bpc_5', features: { subscription_cancel: {} } })[0],
               'unknown');
  assert.equal(verdict(null)[0], 'unknown');
});
