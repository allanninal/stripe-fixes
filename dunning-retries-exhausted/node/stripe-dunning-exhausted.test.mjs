import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-dunning-exhausted.mjs';

test('dunning still running is not a finding', () => {
  const [state, detail] = verdict(2, 1.5, 9900);
  assert.equal(state, 'retrying');
  assert.match(detail, /still running/);
});

test('high count with nothing scheduled is exhausted', () => {
  const [state, detail] = verdict(8, null, 9900);
  assert.equal(state, 'exhausted');
  assert.match(detail, /next_payment_attempt is null/);
});

test('high count with an attempt scheduled is a hard decline', () => {
  assert.equal(verdict(8, 2.0, 9900)[0], 'stalled');
  assert.equal(verdict(3, null, 9900)[0], 'stopped_early');
  assert.equal(verdict(4, null, 9900)[0], 'exhausted');
});

test('never attempted is an integration problem', () => {
  const [state, detail] = verdict(0, null, 9900);
  assert.equal(state, 'never_attempted');
  assert.match(detail, /integration problem/);
});

test('a settled balance is not dunning', () => {
  assert.equal(verdict(8, null, 0)[0], 'nothing_due');
});
