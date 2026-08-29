import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-avs-cvc-checks.mjs';

const OFF = { avs_failure: false, cvc_failure: false };
const ON = { avs_failure: true, cvc_failure: true };

test('non card charges are out of scope', () => {
  assert.equal(verdict(null, true, OFF)[0], 'not_card');
});

test('all null checks means nothing was ever collected', () => {
  const [state, detail] = verdict({}, true, OFF);
  assert.equal(state, 'uncollected');
  assert.ok(detail.includes('never collected'));
});

test('a failed check on a captured charge names the missing setting', () => {
  const checks = { cvc_check: 'pass', address_postal_code_check: 'fail',
                   address_line1_check: 'pass' };
  const [state, detail] = verdict(checks, true, OFF);
  assert.equal(state, 'captured_on_fail');
  assert.ok(detail.includes('address_postal_code_check'));
});

test('a failure the account declines on is a different problem', () => {
  const checks = { cvc_check: 'fail', address_postal_code_check: 'pass',
                   address_line1_check: 'pass' };
  assert.equal(verdict(checks, true, ON)[0], 'captured_despite_setting');
  assert.equal(verdict(checks, false, OFF)[0], 'held');
});

test('passing and inconclusive checks are told apart', () => {
  const passed = { cvc_check: 'pass', address_postal_code_check: 'pass',
                   address_line1_check: 'pass' };
  assert.equal(verdict(passed, true, OFF)[0], 'verified');
  assert.equal(verdict({ ...passed, address_line1_check: 'unavailable' }, true, OFF)[0],
               'unverified');
});
