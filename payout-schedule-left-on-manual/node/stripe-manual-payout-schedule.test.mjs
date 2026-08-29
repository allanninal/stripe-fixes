import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-manual-payout-schedule.mjs';

const manual = (payoutsEnabled = true, delay = 2) => ({
  payouts_enabled: payoutsEnabled,
  settings: { payouts: { schedule: { interval: 'manual', delay_days: delay } } },
});

test('manual with money and no payout ever is stranded', () => {
  const [state, detail] = classify(manual(), 480000, null);
  assert.equal(state, 'stranded');
  assert.match(detail, /no payout has ever been created/);
});

test('manual with money and a recent payout is a running job', () => {
  assert.equal(classify(manual(), 480000, 3.0)[0], 'manual');
});

test('thirty days is the boundary', () => {
  assert.equal(classify(manual(), 100, 29.9)[0], 'manual');
  assert.equal(classify(manual(), 100, 30.0)[0], 'stranded');
});

test('manual with an empty balance is not an incident', () => {
  assert.equal(classify(manual(), 0, null)[0], 'manual');
});

test('payouts disabled is a different problem', () => {
  const [state, detail] = classify(manual(false), 90000, null);
  assert.equal(state, 'disabled');
  assert.match(detail, /requirements first/);
});

test('inflated delay_days is flagged separately', () => {
  const acct = {
    payouts_enabled: true,
    settings: { payouts: { schedule: { interval: 'weekly', delay_days: 30 } } },
  };
  const [state, detail] = classify(acct, null, null);
  assert.equal(state, 'slow');
  assert.match(detail, /delay_days=30/);
});

test('an ordinary daily schedule is quiet', () => {
  const acct = {
    payouts_enabled: true,
    settings: { payouts: { schedule: { interval: 'daily', delay_days: 2 } } },
  };
  assert.equal(classify(acct, null, null)[0], 'scheduled');
});
