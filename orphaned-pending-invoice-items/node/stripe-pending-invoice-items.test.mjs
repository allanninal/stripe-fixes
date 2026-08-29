import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, bucketByCustomer } from './stripe-pending-invoice-items.mjs';

test('a live subscription means the item is merely waiting', () => {
  const [state, detail] = verdict(6, true, 2);
  assert.equal(state, 'waiting');
  assert.ok(detail.includes('2 pending item(s)'));
});

test('no subscription is orphaned at any age', () => {
  assert.equal(verdict(3, false, 1)[0], 'orphaned');
  assert.equal(verdict(400, false, 1)[0], 'orphaned');
});

test('an item created today gets the benefit of the doubt', () => {
  assert.equal(verdict(0.5, false, 1)[0], 'fresh');
  assert.equal(verdict(1, false, 1)[0], 'orphaned');
});

test('the cycle boundaries separate aging from stalled', () => {
  assert.equal(verdict(34.9, true, 1)[0], 'waiting');
  assert.equal(verdict(35, true, 1)[0], 'aging');
  assert.equal(verdict(59.9, true, 1)[0], 'aging');
  assert.equal(verdict(60, true, 1)[0], 'stalled');
});

test('bucketing keeps currencies apart and the oldest date', () => {
  const items = [
    { customer: 'cus_1', date: 500, amount: 1000, currency: 'eur' },
    { customer: 'cus_1', date: 100, amount: 250, currency: 'eur' },
    { customer: 'cus_1', date: 900, amount: 700, currency: 'usd' },
    { customer: null, date: 100, amount: 999, currency: 'eur' },
  ];
  const b = bucketByCustomer(items).get('cus_1');
  assert.equal(b.count, 3);
  assert.equal(b.oldest, 100);
  assert.deepEqual(b.amounts, { EUR: 1250, USD: 700 });
});
