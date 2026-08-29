import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-unpaid-subscriptions.mjs';

const UNPAID = { id: 'sub_1', status: 'unpaid' };

test('unpaid with closed drafts reports the balance owed', () => {
  const [state, detail] = verdict(UNPAID, [
    { auto_advance: false, amount_due: 2500 },
    { auto_advance: false, amount_due: 2500 },
  ]);
  assert.equal(state, 'stranded');
  assert.match(detail, /5000/);
});

test('missing auto_advance counts as closed', () => {
  // Absent is not true. A draft Stripe closed on creation has no flag at all.
  assert.equal(verdict(UNPAID, [{ amount_due: 900 }])[0], 'stranded');
});

test('drafts with auto_advance mean somebody restarted collection', () => {
  assert.equal(verdict(UNPAID, [{ auto_advance: true, amount_due: 900 }])[0],
    'collecting');
});

test('unpaid with no invoices is its own finding', () => {
  const [state, detail] = verdict(UNPAID, []);
  assert.equal(state, 'silent');
  assert.match(detail, /past_due/);
});

test('a past_due subscription is not this problem', () => {
  assert.equal(verdict({ id: 'sub_2', status: 'past_due' }, [])[0], 'not-unpaid');
});
