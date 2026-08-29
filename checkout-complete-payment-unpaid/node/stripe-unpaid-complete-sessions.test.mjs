import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-unpaid-complete-sessions.mjs';

test('a paid session is safe to fulfil', () => {
  assert.equal(verdict('complete', 'paid')[0], 'paid');
});

test('an open session is not this check\'s business', () => {
  assert.equal(verdict('open', 'unpaid')[0], 'skipped');
});

test('unpaid while the intent processes is money in flight', () => {
  const [state, detail] = verdict('complete', 'unpaid', 'processing', ['us_bank_account']);
  assert.equal(state, 'processing');
  assert.match(detail, /us_bank_account/);
});

test('a dead intent means fulfilment has to be unwound', () => {
  const [state, detail] = verdict('complete', 'unpaid', 'requires_payment_method');
  assert.equal(state, 'failed');
  assert.match(detail, /unwound/);
});

test('no payment required is not unpaid', () => {
  assert.equal(verdict('complete', 'no_payment_required')[0], 'free');
});
