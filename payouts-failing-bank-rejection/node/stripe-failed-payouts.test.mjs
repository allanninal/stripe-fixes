import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-failed-payouts.mjs';

test('paid is not treated as final', () => {
  // The paid to failed transition happens up to five business days later. A
  // classifier that calls paid "done" is the bug this guide is about.
  const [state, detail] = classify({ status: 'paid' });
  assert.equal(state, 'open');
  assert.match(detail, /not final/);
});

test('closed account needs new details', () => {
  const [state, detail] = classify({
    status: 'failed',
    failure_code: 'account_closed',
    failure_balance_transaction: 'txn_1',
  });
  assert.equal(state, 'new-details');
  assert.match(detail, /fails identically/);
});

test('debit not authorized is not a bank details problem', () => {
  // The number is right. Attaching a new external account changes nothing.
  const [state, detail] = classify({
    status: 'failed',
    failure_code: 'debit_not_authorized',
    failure_balance_transaction: 'txn_2',
  });
  assert.equal(state, 'bank-authorisation');
  assert.match(detail, /New details will not help/);
});

test('insufficient funds is your side', () => {
  const [state, detail] = classify({
    status: 'failed',
    failure_code: 'insufficient_funds',
    failure_balance_transaction: 'txn_3',
  });
  assert.equal(state, 'funding');
  assert.match(detail, /your side/);
});

test('missing reversal is called out', () => {
  const [, detail] = classify({ status: 'failed', failure_code: 'account_closed' });
  assert.match(detail, /no failure_balance_transaction/);
});

test('unknown code is reported rather than swallowed', () => {
  const [state, detail] = classify({
    status: 'failed',
    failure_code: 'brand_new_code',
    failure_message: 'Something Stripe added later',
  });
  assert.equal(state, 'unclassified');
  assert.match(detail, /brand_new_code/);
  assert.equal(classify({ status: 'in_flight' })[0], 'unknown');
});
