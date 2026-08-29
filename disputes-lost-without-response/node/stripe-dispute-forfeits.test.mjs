import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-dispute-forfeits.mjs';

test('no closed disputes is not a perfect record', () => {
  assert.equal(verdict(0, 0, 0)[0], 'no_disputes');
});

test('losses that were all answered report the real loss rate', () => {
  const [state, detail] = verdict(4, 0, 6);
  assert.equal(state, 'contested');
  assert.match(detail, /40% of the time/);
});

test('forfeits are excluded from the contested loss rate', () => {
  const [state, detail] = verdict(10, 2, 8);
  assert.equal(state, 'leaking');
  assert.match(detail, /16 contested/);
  assert.match(detail, /50% of the time/);
});

test('thirty percent forfeits is the alarm and it is inclusive', () => {
  assert.equal(verdict(100, 29, 0)[0], 'leaking');
  const [state, detail] = verdict(10, 3, 0);
  assert.equal(state, 'absent');
  assert.match(detail, /no dispute workflow/);
});

test('every loss forfeited has no loss rate to quote', () => {
  const [state, detail] = verdict(5, 5, 0);
  assert.equal(state, 'absent');
  assert.match(detail, /nothing was contested/);
  assert.equal(verdict(1, 2, 0)[0], 'unknown');
});
