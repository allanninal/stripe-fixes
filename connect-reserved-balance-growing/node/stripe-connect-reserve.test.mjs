import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-connect-reserve.mjs';

test('a collection transfer outranks everything else', () => {
  const [state, detail] = classify({ currency: 'usd', amount: 4000 }, 4000, 25000);
  assert.equal(state, 'written-off');
  assert.match(detail, /connect_collection_transfer/);
});

test('reserve with recent activity is growing', () => {
  const [state, detail] = classify({ currency: 'usd', amount: 12000 }, 9000, 0);
  assert.equal(state, 'growing');
  assert.match(detail, /12000/);
});

test('reserve with no activity is the dead account case', () => {
  const [state, detail] = classify({ currency: 'usd', amount: 12000 }, 0, 0);
  assert.equal(state, 'held');
  assert.match(detail, /180 day/);
});

test('activity with nothing held is normal operation', () => {
  assert.equal(classify({ currency: 'eur', amount: 0 }, 30000, 0)[0], 'settled');
});

test('missing amount is not silently clear', () => {
  assert.equal(classify({ currency: 'usd' }, 0, 0)[0], 'unknown');
});
