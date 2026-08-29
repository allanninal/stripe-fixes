import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-orphan-payments.mjs';

test('a repeat fingerprint outranks a tiny share', () => {
  const [state, detail] = verdict(4000, 6, 2);
  assert.equal(state, 'repeat');
  assert.match(detail, /2/);
});

test('majority orphaned means guest checkout is the default', () => {
  assert.equal(verdict(1000, 499, 0)[0], 'guests');
  assert.equal(verdict(1000, 500, 0)[0], 'dominant');
});

test('a few orphans are reported without alarm', () => {
  const [state, detail] = verdict(1000, 30, 0);
  assert.equal(state, 'guests');
  assert.match(detail, /deliberate/);
});

test('every intent attached is clear', () => {
  assert.equal(verdict(1000, 0, 0)[0], 'clear');
});

test('an empty window is not silently clear', () => {
  assert.equal(verdict(0, 0, 0)[0], 'unknown');
});
