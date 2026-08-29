import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-external-account-errored.mjs';

const NOW = 1767225600; // 2026-01-01T00:00:00Z

const bank = (status, defaultForCurrency = true, currency = 'usd') => ({
  id: 'ba_1', status, currency, default_for_currency: defaultForCurrency,
});

test('a validated account is healthy', () => {
  const [state, detail] = verdict(bank('validated'), null, null, NOW);
  assert.equal(state, 'healthy');
  assert.match(detail, /payouts can be sent/);
});

test('new is not an error', () => {
  assert.equal(verdict(bank('new'), null, null, NOW)[0], 'healthy');
});

test('every halting status is caught and carries its own repair', () => {
  for (const status of ['errored', 'verification_failed',
    'tokenized_account_number_deactivated']) {
    const [state, detail] = verdict(bank(status), null, null, NOW);
    assert.equal(state, 'halted', status);
    assert.ok(detail.includes(status));
  }
});

test('errored says not to edit the existing object', () => {
  const [, detail] = verdict(bank('errored'), null, null, NOW);
  assert.match(detail, /does not clear this/);
  assert.match(detail, /NEW external account/);
});

test('a balance behind a frozen destination is stranded', () => {
  const [state, detail] = verdict(bank('errored'), NOW - 45 * 86400, 812340, NOW);
  assert.equal(state, 'stranded');
  assert.match(detail, /812340/);
  assert.match(detail, /45 day\(s\) ago/);
});

test('evidence that was never gathered is not reported as no money', () => {
  // A null available amount means nobody looked, which is not the same as zero.
  assert.ok(!verdict(bank('errored'), null, null, NOW)[1]
    .includes('no payout has ever been attempted'));
  assert.ok(verdict(bank('errored'), null, 0, NOW)[1]
    .includes('no payout has ever been attempted'));
});

test('a frozen non default destination is flagged as cleanup', () => {
  const [, detail] = verdict(bank('verification_failed', false), null, null, NOW);
  assert.match(detail, /not the default destination for usd/);
});

test('no bank account at all is its own answer', () => {
  assert.equal(verdict(null, null, null, NOW)[0], 'no-destination');
});

test('an unrecognised status is not assumed healthy', () => {
  assert.equal(verdict(bank('some_new_status'), null, null, NOW)[0], 'unknown');
});
