import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-efw-actionable.mjs';

const NOW = 1_700_000_000;

const warning = (kw = {}) => ({
  id: 'issfr_1',
  actionable: true,
  charge: 'ch_1',
  fraud_type: 'made_with_stolen_card',
  created: NOW - 3 * 86400,
  ...kw,
});

const charge = (kw = {}) => ({
  id: 'ch_1',
  amount: 4500,
  currency: 'usd',
  amount_refunded: 0,
  refunded: false,
  disputed: false,
  ...kw,
});

test('an untouched actionable warning is flagged with its age', () => {
  const [state, detail] = classify(warning(), charge(), NOW);
  assert.equal(state, 'actionable');
  assert.match(detail, /3\.0 day/);
});

test('a partial refund does not close the window', () => {
  const [state, detail] = classify(warning(), charge({ amount_refunded: 500 }), NOW);
  assert.equal(state, 'partial');
  assert.match(detail, /still actionable/);
});

test('a full refund is the outcome this check exists for', () => {
  assert.equal(
    classify(warning(), charge({ refunded: true, amount_refunded: 4500 }), NOW)[0],
    'refunded');
  assert.equal(
    classify(warning(), charge({ amount_refunded: 4500 }), NOW)[0], 'refunded');
});

test('a disputed charge is past the window not pending in it', () => {
  const [state, detail] = classify(warning(), charge({ disputed: true }), NOW);
  assert.equal(state, 'escalated');
  assert.match(detail, /fee/);
});

test('the actionable flag and an unreadable charge are both respected', () => {
  assert.equal(classify(warning({ actionable: false }), charge(), NOW)[0],
               'not_actionable');
  assert.equal(classify(warning(), null, NOW)[0], 'unknown');
});
