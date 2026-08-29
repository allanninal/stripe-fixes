import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-platform-paused.mjs';

const NOW = 1767225600; // 2026-01-01T00:00:00Z

const account = (reason = null, charges = true, payouts = true) => ({
  id: 'acct_1',
  charges_enabled: charges,
  payouts_enabled: payouts,
  requirements: { disabled_reason: reason },
});

test('a normal account is healthy', () => {
  assert.equal(verdict(account(), 0, null, NOW)[0], 'healthy');
});

test('platform paused is named and says which side is off', () => {
  const [state, detail] = verdict(account('platform_paused', true, false), 0, null, NOW);
  assert.equal(state, 'paused');
  assert.match(detail, /payouts off/);
  assert.match(detail, /no API call reverses this/);
});

test('a pause on both sides says both', () => {
  const [, detail] = verdict(account('platform_paused', false, false), 0, null, NOW);
  assert.match(detail, /charges and payouts off/);
});

test('canceled payouts date the pause', () => {
  const [, detail] = verdict(account('platform_paused', true, false),
    4, NOW - 174 * 86400, NOW);
  assert.match(detail, /4 canceled payout\(s\)/);
  assert.match(detail, /at least 174 day\(s\)/);
});

test('other disabled reasons are not claimed by this check', () => {
  // The failure this note describes starts with somebody treating a pause as a
  // missing field. Doing the reverse is just as wrong.
  for (const reason of ['requirements.past_due', 'rejected.fraud', 'under_review',
    'requirements.pending_verification']) {
    const [state, detail] = verdict(account(reason, false, false), 0, null, NOW);
    assert.equal(state, 'other-reason', reason);
    assert.ok(detail.includes(reason));
  }
});

test('canceled payouts without a pause are residue', () => {
  const [state, detail] = verdict(account(), 3, NOW - 200 * 86400, NOW);
  assert.equal(state, 'residue');
  assert.match(detail, /never re-issued/);
});
