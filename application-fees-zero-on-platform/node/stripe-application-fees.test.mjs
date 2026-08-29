import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-application-fees.mjs';

test('no destination charges is not a finding', () => {
  assert.equal(classify(0, 0, 0, 0)[0], 'idle');
});

test('destination charges with no fees anywhere', () => {
  const [state, detail] = classify(0, 480, 0, 0);
  assert.equal(state, 'zero');
  assert.match(detail, /480/);
});

test('under transferring is revenue that no report shows', () => {
  const [state, detail] = classify(0, 480, 0, 480);
  assert.equal(state, 'invisible');
  assert.match(detail, /transfer_data\[amount\]/);
});

test('one code path missing the parameter', () => {
  const [state, detail] = classify(360, 480, 360, 0);
  assert.equal(state, 'partial');
  assert.match(detail, /120 of 480/);
});

test('counts that do not add up are not reported as healthy', () => {
  assert.equal(classify(10, 5, 4, 3)[0], 'unknown');
});
