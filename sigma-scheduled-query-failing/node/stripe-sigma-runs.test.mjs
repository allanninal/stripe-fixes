import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runState, verdict } from './stripe-sigma-runs.mjs';

test('completed run with a live result is fine', () => {
  assert.equal(runState('completed', null, 3 * 86400)[0], 'completed');
});

test('completed but expired is its own state', () => {
  const [state, detail] = runState('completed', null, -7200);
  assert.equal(state, 'expired');
  assert.match(detail, /2\.0 hour\(s\) ago/);
});

test('timed out is distinguished from failed and canceled', () => {
  assert.equal(runState('timed_out', null, null)[0], 'timed_out');
  assert.match(runState('failed', 'syntax error at or near FROM', null)[1], /^syntax/);
  assert.equal(runState('canceled', null, null)[0], 'canceled');
});

test('all completed but the schedule has stopped', () => {
  const [state, detail] = verdict(Array(8).fill('completed'), 456, 168, true);
  assert.equal(state, 'missing');
  assert.match(detail, /stopped producing runs/);
});

test('completed runs with no subscriber are not clear', () => {
  assert.equal(verdict(['completed'], 6, 24, false)[0], 'email_only');
  assert.equal(verdict(['completed'], 6, 24, true)[0], 'clear');
  assert.equal(verdict([], null, 24, true)[0], 'silent');
});
