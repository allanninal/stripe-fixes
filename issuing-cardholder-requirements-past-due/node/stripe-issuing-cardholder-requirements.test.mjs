import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainDecline, verdict } from './stripe-issuing-cardholder-requirements.mjs';

const TERMS = ['individual.card_issuing.user_terms_acceptance.ip',
  'individual.card_issuing.user_terms_acceptance.date'];

const cardholder = (pastDue = [], reason = null, status = 'active') => ({
  id: 'ich_1', status, requirements: { past_due: pastDue, disabled_reason: reason },
});

test('a clean active cardholder with no inactive cards is healthy', () => {
  assert.equal(verdict(cardholder(), 0)[0], 'healthy');
});

test('terms only is not a verification problem', () => {
  const [state, detail] = verdict(cardholder(TERMS), 3);
  assert.equal(state, 'blocked-terms');
  assert.match(detail, /Nothing needs verifying/);
  assert.match(detail, /3 inactive card\(s\)/);
});

test('one identity field alongside terms is an identity block', () => {
  // All-or-nothing on purpose: a passport scan in the list means somebody has to
  // send documents, whatever else is in there with it.
  assert.equal(verdict(cardholder([...TERMS, 'individual.dob.day']), 1)[0],
    'blocked-identity');
});

test('identity fields are named in the detail', () => {
  const [state, detail] = verdict(
    cardholder(['individual.first_name', 'individual.last_name']), 0);
  assert.equal(state, 'blocked-identity');
  assert.match(detail, /individual.first_name/);
});

test('a clean cardholder with inactive cards is a gap in your own flow', () => {
  const [state, detail] = verdict(cardholder(), 4);
  assert.equal(state, 'dormant');
  assert.match(detail, /nobody ever called it/);
});

test('a disabled reason without past due is reported separately', () => {
  assert.equal(verdict(cardholder([], 'listed'), 2)[0], 'disabled');
});

test('an inactive cardholder with nothing outstanding says so', () => {
  const [state, detail] = verdict(cardholder([], null, 'inactive'), 1);
  assert.equal(state, 'inactive-cardholder');
  assert.match(detail, /deliberately/);
});

test('every known decline reason gets its own repair', () => {
  const reasons = ['card_inactive', 'cardholder_inactive', 'verification_failed',
    'insufficient_funds', 'spending_controls', 'webhook_timeout'];
  const hints = reasons.map(explainDecline);
  assert.equal(new Set(hints).size, 6);
  assert.match(explainDecline('insufficient_funds'), /top it up/);
  assert.match(explainDecline('webhook_timeout'), /latency/);
});

test('an unknown decline reason is named not swallowed', () => {
  assert.match(explainDecline('some_new_reason'), /some_new_reason/);
});
