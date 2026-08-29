import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-elevated-risk-review.mjs';

function charge({ risk = 'elevated', type = 'authorized', review = null,
                  captured = true, disputed = false } = {}) {
  return {
    id: 'ch_1',
    amount: 12900,
    currency: 'usd',
    captured,
    disputed,
    review,
    outcome: { risk_level: risk, type },
  };
}

test('elevated captured with no review is the finding', () => {
  const [state, detail] = verdict(charge());
  assert.equal(state, 'straight-through');
  assert.match(detail, /no human/);
});

test('elevated that reached review is not flagged', () => {
  assert.equal(verdict(charge({ review: 'prv_1' }))[0], 'reviewed');
});

test('elevated still on a hold is its own state', () => {
  const [state, detail] = verdict(charge({ captured: false }));
  assert.equal(state, 'uncaptured');
  assert.match(detail, /released/);
});

test('elevated already disputed is separated from the rest', () => {
  assert.equal(verdict(charge({ disputed: true }))[0], 'disputed');
});

test('not_assessed is not reported as clean', () => {
  const [state, detail] = verdict(charge({ risk: 'not_assessed' }));
  assert.equal(state, 'not_assessed');
  assert.match(detail, /never scored/);
});
