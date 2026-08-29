import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-unsubscribed-events.mjs';

const SUBSCRIBED = ['payment_intent.succeeded', 'invoice.paid'];

test('a subscribed type is covered', () => {
  assert.equal(classify('invoice.paid', 12, SUBSCRIBED)[0], 'covered');
});

test('a type with no sibling subscribed is missed', () => {
  const [state, detail] = classify('charge.dispute.created', 7, SUBSCRIBED);
  assert.equal(state, 'missed');
  assert.match(detail, /7 time\(s\)/);
});

test('a sibling subscription does not cover the type', () => {
  const [state, detail] = classify('payment_intent.payment_failed', 31, SUBSCRIBED);
  assert.equal(state, 'near-miss');
  assert.match(detail, /payment_intent\.succeeded/);
});

test('a namespace pattern is not a subscription', () => {
  const [state] = classify('payment_intent.succeeded', 5, ['payment_intent.*']);
  assert.notEqual(state, 'covered');
  assert.equal(state, 'near-miss');
});

test('a wildcard covers everything', () => {
  assert.equal(classify('radar.early_fraud_warning.created', 2, ['*'])[0], 'wildcard');
});

test('a type that never fired is not a gap', () => {
  assert.equal(classify('invoice.paid', 0, [])[0], 'unseen');
});
