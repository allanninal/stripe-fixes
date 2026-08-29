import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-draft-invoices.mjs';

test('recent drafts are not a finding', () => {
  assert.equal(verdict(29.9, false, null, 5000)[0], 'fresh');
  assert.equal(verdict(30.0, false, null, 5000)[0], 'stranded');
});

test('auto_advance false is stranded, not late', () => {
  const [state, detail] = verdict(90.0, false, null, 12000);
  assert.equal(state, 'stranded');
  assert.match(detail, /none will be/);
});

test('zero amount is clutter before it is stranded', () => {
  assert.equal(verdict(90.0, false, null, 0)[0], 'empty');
});

test('auto_advance true with no schedule is unscheduled', () => {
  assert.equal(verdict(45.0, true, null, 8000)[0], 'unscheduled');
});

test('a past finalization time means it failed', () => {
  const [state, detail] = verdict(45.0, true, -3.0, 8000);
  assert.equal(state, 'blocked');
  assert.match(detail, /last_finalization_error/);
});

test('a future finalization time is left alone', () => {
  assert.equal(verdict(45.0, true, 0.5, 8000)[0], 'scheduled');
});
