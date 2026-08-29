import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, verdict } from './stripe-duplicate-customers.mjs';

const rec = (id, card = false, sub = false) =>
  ({ id, has_card: card, has_subscription: sub });

test('normalisation folds case and whitespace', () => {
  assert.equal(normalise('  Ada@Example.COM '), 'ada@example.com');
  assert.equal(normalise(''), null);
  assert.equal(normalise(null), null);
});

test('a single record is not a duplicate', () => {
  assert.equal(verdict([rec('cus_1', true)])[0], 'unique');
});

test('two live subscriptions is the billing case', () => {
  const [state, detail] = verdict([rec('cus_1', false, true), rec('cus_2', false, true)]);
  assert.equal(state, 'split_billing');
  assert.match(detail, /cancelling one/);
});

test('two records holding cards is a support problem not a billing one', () => {
  assert.equal(verdict([rec('cus_1', true), rec('cus_2', true)])[0], 'split_methods');
});

test('duplicates holding nothing are ranked below ones that do', () => {
  assert.equal(verdict([rec('cus_1', true), rec('cus_2')])[0], 'shells');
  assert.equal(verdict([rec('cus_1'), rec('cus_2'), rec('cus_3')])[0], 'empty');
});
