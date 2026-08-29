import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authority, verdict } from './stripe-account-api-version.mjs';

const TODAY = '2026-01-15';

test('nothing readable is not reported as current', () => {
  const [version, note] = authority(null, null);
  assert.equal(version, null);
  assert.equal(verdict(version, TODAY)[0], 'unknown');
  assert.match(note, /30 day/);
});

test('the header wins and the disagreement is named', () => {
  const [version, note] = authority('2024-09-30.acacia', '2025-09-30.clover');
  assert.equal(version, '2025-09-30.clover');
  assert.match(note, /2024-09-30\.acacia/);
  assert.match(note, /72 hour/);
});

test('over a year behind is stale and under it is not', () => {
  assert.equal(verdict('2024-09-30.acacia', TODAY)[0], 'stale');
  assert.equal(verdict('2025-03-31.basil', TODAY)[0], 'trailing');
});

test('the release line suffix is trimmed before comparing', () => {
  assert.equal(verdict('2025-09-30.clover', TODAY)[0], 'current');
});

test('a version with no date is not silently current', () => {
  assert.equal(verdict('beta', TODAY)[0], 'unreadable');
});
