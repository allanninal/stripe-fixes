import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStepUpDecline, hasMandate, verdict } from './stripe-offsession-mandates.mjs';

const GOOD_SI = { status: 'succeeded', mandate: 'mandate_123' };

test('authentication_required is a step up decline', () => {
  assert.equal(isStepUpDecline({
    last_payment_error: { code: 'card_declined',
                          decline_code: 'authentication_required' },
  }), true);
});

test('authentication_not_handled counts too', () => {
  assert.equal(isStepUpDecline({
    last_payment_error: { decline_code: 'authentication_not_handled' },
  }), true);
});

test('an ordinary decline is not one', () => {
  assert.equal(isStepUpDecline({
    last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
  }), false);
});

test('a succeeded setup intent without a mandate is not proof', () => {
  assert.equal(hasMandate([{ status: 'succeeded', mandate: null }]), false);
});

test('an abandoned setup intent is not proof', () => {
  assert.equal(hasMandate([{ status: 'requires_confirmation', mandate: null }]), false);
});

test('declines without a mandate are a card saving bug', () => {
  const [state, detail] = verdict(4, 1, [{ status: 'succeeded', mandate: null }]);
  assert.equal(state, 'unmandated');
  assert.match(detail, /4/);
});

test('declines with a mandate are the issuer stepping up', () => {
  const [state, detail] = verdict(2, 1, [GOOD_SI]);
  assert.equal(state, 'stepped_up');
  assert.match(detail, /on-session/);
});

test('saved cards with no mandate and no declines yet are at risk', () => {
  assert.equal(verdict(0, 3, [])[0], 'at_risk');
});

test('saved cards behind a mandate are covered', () => {
  assert.equal(verdict(0, 2, [GOOD_SI])[0], 'covered');
});

test('a customer with no saved cards is clear', () => {
  assert.equal(verdict(0, 0, [])[0], 'clear');
});
