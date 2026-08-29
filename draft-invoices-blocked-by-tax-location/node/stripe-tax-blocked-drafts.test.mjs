import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, classify } from './stripe-tax-blocked-drafts.mjs';

test('the finalization error is the headline', () => {
  const [state, detail] = verdict('customer_tax_location_invalid',
    'requires_location_inputs', null, true);
  assert.equal(state, 'tax-location');
  assert.match(detail, /cannot resolve/);
});

test('tax dropped is reported even though the invoice will finalize', () => {
  const [state, detail] = verdict(null, 'requires_location_inputs',
    'finalization_requires_location_inputs', true);
  assert.equal(state, 'tax-dropped');
  assert.match(detail, /no tax on it/);
});

test('requires_location_inputs alone is a warning, not an error', () => {
  assert.equal(verdict(null, 'requires_location_inputs', null, true)[0], 'needs-address');
});

test('a Stripe side failure is not the customer address', () => {
  const [state, detail] = verdict(null, 'failed', null, true);
  assert.equal(state, 'tax-failed');
  assert.match(detail, /retry the finalization/);
});

test('a non tax finalization error is kept separate', () => {
  const [state, detail] = verdict('invoice_payment_intent_requires_action', null, null, true);
  assert.equal(state, 'other-error');
  assert.match(detail, /not tax/);
});

test('auto_advance is read last', () => {
  assert.equal(verdict('customer_tax_location_invalid', null, null, false)[0], 'tax-location');
  assert.equal(verdict(null, null, null, false)[0], 'not-advancing');
});

test('classify reads the nested invoice fields', () => {
  const inv = {
    last_finalization_error: { code: 'customer_tax_location_invalid' },
    automatic_tax: { status: 'requires_location_inputs' },
    auto_advance: true,
  };
  assert.equal(classify(inv)[0], 'tax-location');
  assert.equal(classify({ auto_advance: true, automatic_tax: { status: 'complete' } })[0], 'clear');
});
