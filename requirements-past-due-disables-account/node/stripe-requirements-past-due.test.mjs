import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-requirements-past-due.mjs';

const NOW = 1800000000;
const DAY = 86400;

test('past due wins over the array that contains it', () => {
  // past_due is a strict subset of currently_due. Reading the outer array first
  // is exactly the bug this check exists to avoid.
  const [state, detail] = classify({
    past_due: ['company.tax_id'],
    currently_due: ['company.tax_id', 'business_profile.url'],
    current_deadline: NOW - 3 * DAY,
  }, NOW);
  assert.equal(state, 'past-due');
  assert.match(detail, /company\.tax_id/);
});

test('near deadline is separated from a distant one', () => {
  const reqs = { currently_due: ['company.tax_id'], current_deadline: NOW + 20 * DAY };
  assert.equal(classify(reqs, NOW)[0], 'due');
  reqs.current_deadline = NOW + 13 * DAY;
  assert.equal(classify(reqs, NOW)[0], 'deadline');
});

test('fourteen days is inside the window', () => {
  assert.equal(
    classify({ currently_due: ['x'], current_deadline: NOW + 14 * DAY }, NOW)[0],
    'deadline');
});

test('passed deadline without past due is still reported', () => {
  // Stripe moves the fields on its own schedule, so there is a gap where the
  // deadline is behind you and past_due is still empty.
  const [state, detail] = classify(
    { currently_due: ['x'], current_deadline: NOW - 2 * DAY }, NOW);
  assert.equal(state, 'overdue');
  assert.match(detail, /expect past_due next/);
});

test('pending verification is not work for anyone', () => {
  assert.equal(classify({ pending_verification: ['individual.id_number'] }, NOW)[0],
    'pending');
});

test('eventually due alone is not urgent and empty is clear', () => {
  assert.equal(classify({ eventually_due: ['company.tax_id'] }, NOW)[0], 'eventual');
  assert.equal(classify({}, NOW)[0], 'clear');
  assert.equal(classify(null, NOW)[0], 'clear');
});
