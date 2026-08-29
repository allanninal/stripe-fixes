import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-expired-capture-refunds.mjs';

function refund(reason = 'requested_by_customer') {
  const out = { id: 're_1', amount: 4900, currency: 'usd', charge: 'ch_1' };
  if (reason !== null) out.reason = reason;
  return out;
}

test('expired reason with an uncaptured charge is confirmed', () => {
  const [state, detail] = classify(refund('expired_uncaptured_charge'), { captured: false });
  assert.equal(state, 'expired');
  assert.match(detail, /no customer asked/);
});

test('expired reason without the charge is only a candidate', () => {
  const [state, detail] = classify(refund('expired_uncaptured_charge'));
  assert.equal(state, 'expired-unverified');
  assert.match(detail, /unconfirmed/);
});

test('expired reason on a captured charge is flagged, not counted', () => {
  const [state, detail] = classify(refund('expired_uncaptured_charge'), { captured: true });
  assert.equal(state, 'inconsistent');
  assert.match(detail, /captured=true/);
});

test('a customer refund stays in the rate', () => {
  const [state, detail] = classify(refund('requested_by_customer'), { captured: true });
  assert.equal(state, 'customer');
  assert.match(detail, /refund rate/);
});

test('a refund with no reason is not treated as expired', () => {
  assert.equal(classify(refund(null))[0], 'unlabelled');
});
