import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-save-default-pm.mjs';

function sub(over = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    payment_settings: {},
    default_payment_method: null,
    customer: { id: 'cus_1', invoice_settings: {} },
    ...over,
  };
}

test('an absent flag is treated as off', () => {
  assert.equal(verdict(sub({ payment_settings: {} }))[0], 'stranded');
});

test('an explicit off reaches the same verdict', () => {
  assert.equal(
    verdict(sub({ payment_settings: { save_default_payment_method: 'off' } }))[0],
    'stranded');
});

test('on_subscription is the fix', () => {
  assert.equal(
    verdict(sub({ payment_settings: { save_default_payment_method: 'on_subscription' } }))[0],
    'on');
});

test('a subscription default makes the flag moot', () => {
  assert.equal(verdict(sub({ default_payment_method: 'pm_1' }))[0], 'saved');
});

test('a customer default is a fallback not a fix', () => {
  const [state, detail] = verdict(sub({
    customer: { id: 'cus_1', invoice_settings: { default_payment_method: 'pm_2' } },
  }));
  assert.equal(state, 'fallback');
  assert.match(detail, /refactor/);
});

test('past_due with nothing to charge has already failed', () => {
  assert.equal(verdict(sub({ status: 'past_due' }))[0], 'failing');
});

test('an unexpanded customer is not silently stranded', () => {
  const [state, detail] = verdict(sub({ customer: 'cus_1' }));
  assert.equal(state, 'unknown');
  assert.match(detail, /expand/);
});

test('an unrecognised value is not silently healthy', () => {
  assert.equal(
    verdict(sub({ payment_settings: { save_default_payment_method: 'always' } }))[0],
    'unknown');
});
