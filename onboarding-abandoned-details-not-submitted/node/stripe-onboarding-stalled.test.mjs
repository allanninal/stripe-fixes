import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-onboarding-stalled.mjs';

const acct = (submitted = false, due = [
  'individual.dob.day', 'individual.address.line1',
  'business_profile.url', 'external_account',
]) => ({ details_submitted: submitted, requirements: { currently_due: due } });

test('a submitted account is finished', () => {
  assert.equal(classify(acct(true), 400.0)[0], 'submitted');
});

test('a fresh signup is not chased', () => {
  const [state, detail] = classify(acct(), 1.5);
  assert.equal(state, 'in-flight');
  assert.match(detail, /do not chase it yet/);
});

test('seven days is the boundary', () => {
  assert.equal(classify(acct(), 6.9)[0], 'in-flight');
  assert.equal(classify(acct(), 7.0)[0], 'abandoned-cold');
});

test('a short remaining list means they nearly finished', () => {
  const [state, detail] = classify(acct(false, ['external_account']), 40.0);
  assert.equal(state, 'abandoned-late');
  assert.match(detail, /external_account/);
});

test('unsubmitted with nothing due is a different bug', () => {
  const [state, detail] = classify(acct(false, []), 40.0);
  assert.equal(state, 'unknown');
  assert.match(detail, /no capability has been requested/);
});
