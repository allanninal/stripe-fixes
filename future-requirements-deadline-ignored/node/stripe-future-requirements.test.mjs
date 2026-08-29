import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-future-requirements.mjs';

const NOW = 1700000000;
const account = (future) => ({
  controller: { requirement_collection: 'application' },
  future_requirements: future,
});

test('stripe collected accounts are never reported', () => {
  const acct = {
    controller: { requirement_collection: 'stripe' },
    future_requirements: { currently_due: ['id_number'], current_deadline: NOW + 3600 },
  };
  assert.equal(verdict(acct, NOW)[0], 'stripe-managed');
});

test('a distant deadline is scheduled', () => {
  const acct = account({ currently_due: ['id_number'],
                         current_deadline: NOW + 42 * 86400 });
  assert.equal(verdict(acct, NOW)[0], 'scheduled');
});

test('the same account is urgent inside the window', () => {
  const acct = account({ currently_due: ['id_number'],
                         current_deadline: NOW + 5 * 86400 });
  const [state, detail] = verdict(acct, NOW);
  assert.equal(state, 'due-soon');
  assert.match(detail, /id_number/);
});

test('an elapsed deadline is overdue not merely urgent', () => {
  const acct = account({ currently_due: ['id_number'], current_deadline: NOW - 86400 });
  assert.equal(verdict(acct, NOW)[0], 'overdue');
});

test('future entries without a deadline are their own state', () => {
  const acct = account({ currently_due: ['id_number'], current_deadline: null });
  assert.equal(verdict(acct, NOW)[0], 'undated');
});

test('eventually_due alone is not urgent and not silent', () => {
  assert.equal(verdict(account({ eventually_due: ['id_number'] }), NOW)[0], 'eventual');
});

test('an empty future hash is clear', () => {
  assert.equal(verdict(account({}), NOW)[0], 'clear');
});
