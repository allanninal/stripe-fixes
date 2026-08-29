import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-stale-intents.mjs';

const NOW = 1800000000;
const DAY = 86400;

function pi({ status = 'requires_payment_method', ageD = 30, err = null } = {}) {
  const out = { status, created: NOW - ageD * DAY };
  if (err !== null) out.last_payment_error = err;
  return out;
}

test('old intent with no error was never attempted', () => {
  const [state, detail] = classify(pi({ ageD: 30 }), NOW);
  assert.equal(state, 'never-attempted');
  assert.match(detail, /no payment method/);
});

test('old intent with an error is a missing retry', () => {
  const [state, detail] = classify(
    pi({ ageD: 30, err: { decline_code: 'insufficient_funds' } }), NOW);
  assert.equal(state, 'declined');
  assert.match(detail, /insufficient_funds/);
});

test('requires_confirmation is the server omission', () => {
  const [state, detail] = classify(pi({ status: 'requires_confirmation', ageD: 30 }), NOW);
  assert.equal(state, 'unconfirmed');
  assert.match(detail, /confirm/);
});

test('a two day old intent is still live', () => {
  assert.equal(classify(pi({ ageD: 2 }), NOW)[0], 'recent');
});

test('succeeded intents are not counted', () => {
  assert.equal(classify(pi({ status: 'succeeded' }), NOW)[0], 'other');
});
