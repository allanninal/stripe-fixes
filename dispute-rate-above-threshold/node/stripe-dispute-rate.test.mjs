import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, rates } from './stripe-dispute-rate.mjs';

test('no successful charges is not an infinite rate', () => {
  assert.deepEqual(rates(3, 0, 0), [null, null]);
  const [state, detail] = assess(3, 0, 0);
  assert.equal(state, 'no_volume');
  assert.match(detail, /divide/);
});

test('the half percent vamp line is inclusive', () => {
  assert.equal(assess(10, 0, 2000)[0], 'watch');
  assert.equal(assess(9, 0, 2000)[0], 'clear');
});

test('early fraud warnings count toward the visa ratio', () => {
  const [disputeRate, vampRate] = rates(4, 8, 2000);
  assert.ok(disputeRate < 0.005);
  assert.ok(vampRate > 0.005);
  const [state, detail] = assess(4, 8, 2000);
  assert.equal(state, 'watch');
  assert.match(detail, /EFW/);
});

test('a high ratio under the count floor is not a breach', () => {
  const [state, detail] = assess(2, 1, 200);
  assert.equal(state, 'below_floor');
  assert.match(detail, /VAMP needs 5/);
});

test('the bands above the line are distinct', () => {
  assert.equal(assess(16, 0, 2000)[0], 'excessive');
  assert.equal(assess(40, 0, 2000)[0], 'program');
  assert.equal(assess(11, 0, 2000)[0], 'watch');
});
