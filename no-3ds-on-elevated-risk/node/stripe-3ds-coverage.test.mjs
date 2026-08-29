import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, coverage } from './stripe-3ds-coverage.mjs';

function cardCharge(risk = 'normal', threeDSecure = null, status = 'succeeded') {
  const card = { brand: 'visa' };
  if (threeDSecure !== null) card.three_d_secure = threeDSecure;
  return {
    id: 'ch_1',
    status,
    amount: 9900,
    currency: 'usd',
    outcome: { risk_level: risk },
    payment_method_details: { type: 'card', card },
  };
}

test('elevated risk with no authentication is the finding', () => {
  const [state, detail] = classify(cardCharge('elevated'));
  assert.equal(state, 'unprotected');
  assert.match(detail, /liability/);
});

test('normal risk with no authentication is not a finding', () => {
  const [state, detail] = classify(cardCharge('normal'));
  assert.equal(state, 'no_3ds');
  assert.match(detail, /share/);
});

test('an acknowledged attempt is not an authentication', () => {
  const [state, detail] = classify(
    cardCharge('highest', { result: 'attempt_acknowledged' }));
  assert.equal(state, 'attempted');
  assert.match(detail, /not/);
  assert.equal(
    classify(cardCharge('highest', { result: 'authenticated' }))[0], 'protected');
});

test('non card and unsettled charges are out of scope', () => {
  assert.equal(
    classify({ payment_method_details: { type: 'us_bank_account' } })[0], 'not_card');
  assert.equal(classify(cardCharge('highest', null, 'failed'))[0], 'not_settled');
});

test('the ten percent coverage floor is inclusive', () => {
  assert.equal(coverage(10, 100)[0], 'low');
  assert.equal(coverage(11, 100)[0], 'ok');
  assert.equal(coverage(0, 0)[0], 'no_volume');
});
