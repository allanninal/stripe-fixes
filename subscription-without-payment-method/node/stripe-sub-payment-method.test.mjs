import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-sub-payment-method.mjs';

test('subscription level payment method wins', () => {
  const [state, detail] = verdict({ default_payment_method: 'pm_1', customer: {} });
  assert.equal(state, 'subscription');
  assert.match(detail, /subscription\.default_payment_method/);
});

test('legacy subscription source is still chargeable', () => {
  const [state, detail] = verdict({ default_source: 'card_1', customer: {} });
  assert.equal(state, 'subscription');
  assert.match(detail, /legacy/);
});

test('customer invoice settings are the third slot', () => {
  const [state, detail] = verdict({
    customer: { invoice_settings: { default_payment_method: 'pm_2' } },
  });
  assert.equal(state, 'customer');
  assert.match(detail, /invoice_settings/);
});

test('customer default source is the fourth slot', () => {
  assert.equal(verdict({ customer: { default_source: 'card_2' } })[0], 'customer');
});

test('all four null is unchargeable and says no retry', () => {
  const [state, detail] = verdict({
    customer: { invoice_settings: { default_payment_method: null }, default_source: null },
  });
  assert.equal(state, 'unchargeable');
  assert.match(detail, /no retry/);
});

test('unexpanded customer is not reported as unchargeable', () => {
  const [state, detail] = verdict({ customer: 'cus_123' });
  assert.equal(state, 'unknown');
  assert.match(detail, /expand/);
});
