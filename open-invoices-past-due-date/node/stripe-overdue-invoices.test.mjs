import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-overdue-invoices.mjs';

test('within terms is current', () => {
  const [state, detail] = verdict(-4.0, 25000);
  assert.equal(state, 'current');
  assert.match(detail, /4.0/);
});

test('the due date itself is already overdue', () => {
  assert.equal(verdict(-0.1, 25000)[0], 'current');
  assert.equal(verdict(0.0, 25000)[0], 'overdue');
});

test('thirty and sixty days are the two boundaries', () => {
  assert.equal(verdict(29.9, 25000)[0], 'overdue');
  assert.equal(verdict(30.0, 25000)[0], 'stale');
  assert.equal(verdict(59.9, 25000)[0], 'stale');
  const [state, detail] = verdict(60.0, 25000);
  assert.equal(state, 'abandoned');
  assert.match(detail, /nothing automated will chase/);
});

test('no due date is reported rather than ignored', () => {
  assert.equal(verdict(null, 25000)[0], 'undated');
});

test('a zero balance is not receivable', () => {
  assert.equal(verdict(120.0, 0)[0], 'nothing_due');
});
