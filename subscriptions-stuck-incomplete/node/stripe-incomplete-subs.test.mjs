import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, WINDOW } from './stripe-incomplete-subs.mjs';

const NOW = 1_800_000_000;

test('a minutes old subscription is not an alert', () => {
  const [state, detail] = verdict({ created: NOW - 1800 }, NOW);
  assert.equal(state, 'pending');
  assert.match(detail, /confirmation step/);
});

test('hours old and unconfirmed is the finding', () => {
  const [state, detail] = verdict({ created: NOW - 5 * 3600 }, NOW);
  assert.equal(state, 'stalled');
  assert.match(detail, /never confirmed/);
});

test('the last two hours are called out separately', () => {
  const [state, detail] = verdict({ created: NOW - (WINDOW - 3600) }, NOW);
  assert.equal(state, 'expiring');
  assert.match(detail, /left before/);
});

test('exactly 23 hours is already expired', () => {
  const [state, detail] = verdict({ created: NOW - WINDOW }, NOW);
  assert.equal(state, 'expired');
  assert.match(detail, /cannot be revived/);
});

test('a row with no timestamp is not silently healthy', () => {
  assert.equal(verdict({}, NOW)[0], 'unknown');
});
