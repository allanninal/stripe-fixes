import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-legacy-card-sources.mjs';

const MODERN_DEFAULT = { invoice_settings: { default_payment_method: 'pm_1' } };

test('migrated customer is modern', () => {
  assert.equal(classify(MODERN_DEFAULT, [], [{ id: 'pm_1' }])[0], 'modern');
});

test('legacy card with no PaymentMethod is the split-brain case', () => {
  const cust = { default_source: 'card_1', invoice_settings: {} };
  const [state, detail] = classify(cust, [{ id: 'card_1' }], []);
  assert.equal(state, 'split_brain');
  assert.match(detail, /no card/);
});

test('src objects count as legacy too', () => {
  const cust = { default_source: 'src_1', invoice_settings: {} };
  assert.equal(classify(cust, [{ id: 'src_1' }], [])[0], 'split_brain');
});

test('both stores with no modern default still renews on the old card', () => {
  const cust = { default_source: 'card_1', invoice_settings: {} };
  const [state, detail] = classify(cust, [{ id: 'card_1' }], [{ id: 'pm_1' }]);
  assert.equal(state, 'split_default');
  assert.match(detail, /falls back/);
});

test('both stores with a modern default is only residue', () => {
  assert.equal(
    classify(MODERN_DEFAULT, [{ id: 'card_1' }], [{ id: 'pm_1' }])[0], 'residue');
});

test('no card anywhere is its own state', () => {
  assert.equal(classify({ invoice_settings: {} }, [], [])[0], 'cardless');
});
