import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-incomplete-expired-rate.mjs';

test('the same count is noise against enough activations', () => {
  const [state, detail] = verdict(20, 4000);
  assert.equal(state, 'background');
  assert.match(detail, /abandonment/);
});

test('the same count is a leak against a small one', () => {
  const [state, detail] = verdict(20, 150);
  assert.equal(state, 'leaking');
  assert.match(detail, /13\.3%/);
});

test('expired with no activations does not divide by zero', () => {
  const [state, detail] = verdict(31, 0, 14);
  assert.equal(state, 'broken');
  assert.match(detail, /not one activated/);
});

test('a quiet window is not reported as healthy signups', () => {
  assert.equal(verdict(0, 0)[0], 'no-signups');
});

test('nothing expired is clean', () => {
  assert.equal(verdict(0, 900)[0], 'clean');
});
