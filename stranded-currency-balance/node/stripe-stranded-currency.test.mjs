import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-stranded-currency.mjs';

test('settled funds with no destination are stranded', () => {
  const [state, detail] = classify({ currency: 'eur', amount: 41200 }, 0, false, 0);
  assert.equal(state, 'stranded');
  assert.match(detail, /41200/);
});

test('pending funds with no destination are caught early', () => {
  const [state, detail] = classify({ currency: 'eur', amount: 0 }, 8000, false, 0);
  assert.equal(state, 'accruing');
  assert.match(detail, /stranded when it settles/);
});

test('a destination that never pays out is its own state', () => {
  const [state, detail] = classify({ currency: 'gbp', amount: 9500 }, 0, true, 0);
  assert.equal(state, 'stalled');
  assert.match(detail, /default_for_currency/);
});

test('destination and payouts is healthy', () => {
  assert.equal(
    classify({ currency: 'usd', amount: 250000 }, 40000, true, 14)[0], 'draining');
});

test('empty bucket with no destination is not a problem', () => {
  assert.equal(classify({ currency: 'eur', amount: 0 }, 0, false, 0)[0], 'clear');
});
