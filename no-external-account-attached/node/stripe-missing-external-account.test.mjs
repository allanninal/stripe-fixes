import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-missing-external-account.mjs';

test('a default destination is the healthy case', () => {
  const [state, detail] = classify(
    [{ currency: 'usd', default_for_currency: true, status: 'verified' }], 'usd');
  assert.equal(state, 'attached');
  assert.match(detail, /default set for usd/);
});

test('nothing attached separates asked from never asked', () => {
  // Stripe asking and nobody collecting is a broken handoff. Stripe not asking
  // means the platform turned collection off and never built the other half.
  assert.equal(classify([], 'usd', ['external_account', 'company.tax_id'])[0], 'none');
  assert.equal(classify([], 'usd', ['company.tax_id'])[0], 'none-unrequested');
});

test('attached but no default still cannot pay out', () => {
  const [state, detail] = classify(
    [{ currency: 'usd', default_for_currency: false, status: 'verified' }], 'usd');
  assert.equal(state, 'no-default');
  assert.match(detail, /nowhere to go/);
});

test('a destination in the wrong currency is not a destination', () => {
  const [state, detail] = classify(
    [{ currency: 'eur', default_for_currency: true, status: 'verified' }], 'usd');
  assert.equal(state, 'wrong-currency');
  assert.match(detail, /usd/);
});

test('case does not decide the answer', () => {
  // Stripe returns lowercase currencies, but an account object copied through a
  // cache or a spreadsheet may not.
  assert.equal(classify(
    [{ currency: 'USD', default_for_currency: true, status: 'verified' }], 'USD')[0],
  'attached');
});

test('an errored default is reported as frozen not healthy', () => {
  const [state, detail] = classify(
    [{ currency: 'usd', default_for_currency: true, status: 'errored' }], 'usd');
  assert.equal(state, 'unusable');
  assert.match(detail, /have stopped/);
});
