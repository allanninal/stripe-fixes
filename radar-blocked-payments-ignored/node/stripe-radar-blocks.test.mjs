import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-radar-blocks.mjs';

function charge(reason, type = 'blocked', seller = 'Stopped') {
  return { outcome: { type, reason, seller_message: seller,
                      network_status: 'not_sent_to_network' } };
}

test('custom rule is named as yours', () => {
  const [state, detail] = classify(charge('rule', 'blocked', 'Blocked by your rule'));
  assert.equal(state, 'rule');
  assert.match(detail, /rule you wrote/);
});

test('radar threshold is not confused with a custom rule', () => {
  const [state, detail] = classify(charge('highest_risk_level'));
  assert.equal(state, 'risk');
  assert.match(detail, /not a rule of yours/);
});

test('adaptive acceptance is not fraud', () => {
  const [state, detail] = classify(charge('low_probability_of_authorization'));
  assert.equal(state, 'adaptive');
  assert.match(detail, /Not fraud/);
});

test('issuer declines are a different investigation', () => {
  assert.equal(classify(charge(null, 'issuer_declined'))[0], 'not-blocked');
});

test('missing outcome is not counted as blocked', () => {
  assert.equal(classify({})[0], 'not-blocked');
});
