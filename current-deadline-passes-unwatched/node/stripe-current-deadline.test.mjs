import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cohortDay, daysLeft, horizon } from './stripe-current-deadline.mjs';

// 2026-01-01T00:00:00Z, so every assertion below is about a date a human can check.
const JAN1 = 1767225600;

const account = (deadline = null, due = []) => ({
  id: 'acct_1',
  requirements: { current_deadline: deadline, currently_due: due },
});

test('a missing deadline is not a date far away', () => {
  assert.equal(daysLeft({ current_deadline: null }, JAN1), null);
  assert.equal(daysLeft({}, JAN1), null);
});

test('days left counts whole days and goes negative', () => {
  assert.equal(daysLeft({ current_deadline: JAN1 + 10 * 86400 }, JAN1), 10);
  assert.equal(daysLeft({ current_deadline: JAN1 + 86399 }, JAN1), 0);
  assert.equal(daysLeft({ current_deadline: JAN1 - 86400 }, JAN1), -1);
});

test('cohort day groups by utc date', () => {
  // Two accounts an hour apart on the same UTC day are one cohort; the third is
  // a separate batch, and separate is the whole point of the grouping.
  assert.equal(cohortDay(JAN1), '2026-01-01');
  assert.equal(cohortDay(JAN1 + 3600), '2026-01-01');
  assert.equal(cohortDay(JAN1 + 86400), '2026-01-02');
  assert.equal(cohortDay(null), null);
});

test('inside the window is urgent and outside it is scheduled', () => {
  const [urgent, detail] = horizon(account(JAN1 + 13 * 86400, ['company.tax_id']), JAN1);
  assert.equal(urgent, 'urgent');
  assert.match(detail, /company.tax_id/);
  assert.match(detail, /2026-01-14/);
  assert.equal(horizon(account(JAN1 + 40 * 86400, ['company.tax_id']), JAN1)[0],
    'scheduled');
});

test('a passed deadline with fields due is an incident not a warning', () => {
  const [state, detail] = horizon(account(JAN1 - 3 * 86400, ['company.tax_id']), JAN1);
  assert.equal(state, 'enforced');
  assert.match(detail, /3 day\(s\) ago/);
  assert.match(detail, /already off/);
});

test('a deadline with nothing due asks nobody for anything', () => {
  const [state, detail] = horizon(account(JAN1 + 5 * 86400, []), JAN1);
  assert.equal(state, 'verifying');
  assert.match(detail, /nothing to collect/);
});

test('fields due with no deadline are still work', () => {
  const [state, detail] = horizon(account(null, ['business_profile.url']), JAN1);
  assert.equal(state, 'undated');
  assert.match(detail, /no date/);
});

test('a healthy account is clear', () => {
  assert.equal(horizon(account(null, []), JAN1)[0], 'clear');
});
