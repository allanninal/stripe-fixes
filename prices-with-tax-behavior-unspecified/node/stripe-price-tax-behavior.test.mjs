import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-price-tax-behavior.mjs';

test('an explicit behavior with a tax code is ready', () => {
  const [state, detail] = verdict('exclusive', 0, 'txcd_10000000', true);
  assert.equal(state, 'ready');
  assert.ok(detail.includes('txcd_10000000'));
});

test('a dormant unspecified price can be fixed in place', () => {
  const [state, detail] = verdict('unspecified', 0, 'txcd_10000000', false);
  assert.equal(state, 'dormant');
  assert.ok(detail.includes('still settable'));
});

test('subscriptions turn the fix into a migration', () => {
  const [state, detail] = verdict('unspecified', 412, 'txcd_10000000', false);
  assert.equal(state, 'live');
  assert.ok(detail.includes('412 active subscription(s)'));
});

test('automatic tax makes it an active fault', () => {
  const [state, detail] = verdict('unspecified', 0, 'txcd_10000000', true);
  assert.equal(state, 'blocking');
  assert.ok(detail.includes('cannot be added'));
});

test('a correct behavior on a product with no tax code is still flagged', () => {
  const [state, detail] = verdict('inclusive', 0, null, false);
  assert.equal(state, 'no-tax-code');
  assert.ok(detail.includes('account default'));
});
