import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-manual-capture-holds.mjs';

const NOW = 1700000000;

const hold = (captureBefore, status = 'requires_capture') => ({
  capture_method: 'manual',
  status,
  latest_charge: {
    payment_method_details: { card: { capture_before: captureBefore } },
  },
});

test('automatic capture is not this problem', () => {
  assert.equal(classify({ capture_method: 'automatic' }, NOW)[0], 'automatic');
});

test('a hold with days left is held', () => {
  const [state, detail] = classify(hold(NOW + 5 * 86400), NOW);
  assert.equal(state, 'held');
  assert.match(detail, /120h/);
});

test('a hold inside the warning window is expiring', () => {
  const [state, detail] = classify(hold(NOW + 6 * 3600), NOW);
  assert.equal(state, 'expiring');
  assert.match(detail, /released to the cardholder/);
});

test('a passed deadline is expired even at requires_capture', () => {
  assert.equal(classify(hold(NOW - 3600), NOW)[0], 'expired');
});

test('missing capture_before is unknown, not safe', () => {
  const [state, detail] = classify(hold(null), NOW);
  assert.equal(state, 'unknown');
  assert.match(detail, /not the same as far away/);
});

test('automatic cancellation is the historical loss', () => {
  const [state, detail] = classify({
    capture_method: 'manual',
    status: 'canceled',
    cancellation_reason: 'automatic',
  }, NOW);
  assert.equal(state, 'lost');
  assert.match(detail, /expired uncaptured/);
});
