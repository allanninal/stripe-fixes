import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-endpoint-api-version.mjs';

test('null is unpinned', () => {
  assert.equal(verdict(null)[0], 'unpinned');
});

test('empty string is also unpinned', () => {
  assert.equal(verdict('')[0], 'unpinned');
});

test('pre acacia is hard flagged', () => {
  const [state, detail] = verdict('2022-11-15');
  assert.equal(state, 'ancient');
  assert.match(detail, /2024-09-30/);
});

test('the suffix is trimmed before comparing', () => {
  assert.equal(verdict('2024-09-30.acacia')[0], 'stale');
  assert.equal(verdict('2025-09-30.clover')[0], 'current');
});

test('a version with no date is not silently current', () => {
  assert.equal(verdict('beta')[0], 'unreadable');
});
