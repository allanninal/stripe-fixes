import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessState, intervalState } from './stripe-report-interval.mjs';

const DAY = 86400;
const AVAIL_END = 1756000000;
const AVAIL_START = AVAIL_END - 90 * DAY;

test('interval inside the window is covered', () => {
  const [state, detail] = intervalState(AVAIL_END - 2 * DAY, AVAIL_END - DAY,
    AVAIL_START, AVAIL_END);
  assert.equal(state, 'covered');
  assert.match(detail, /24\.0 hour/);
});

test('one hour past availability is truncated, not an error', () => {
  const [state, detail] = intervalState(AVAIL_END - DAY, AVAIL_END + 3600,
    AVAIL_START, AVAIL_END);
  assert.equal(state, 'truncated');
  assert.match(detail, /1\.0 hour\(s\) past/);
  assert.match(detail, /succeeded/);
});

test('landing exactly on the edge is a warning, not a pass', () => {
  assert.equal(intervalState(AVAIL_START, AVAIL_END, AVAIL_START, AVAIL_END)[0],
    'at_edge');
  assert.equal(intervalState(AVAIL_START, AVAIL_END - 1800, AVAIL_START, AVAIL_END)[0],
    'at_edge');
  // A full hour of margin is the boundary, and the boundary counts as covered.
  assert.equal(intervalState(AVAIL_START, AVAIL_END - 3600, AVAIL_START, AVAIL_END)[0],
    'covered');
});

test('start before the window is reported separately', () => {
  assert.equal(intervalState(AVAIL_START - DAY, AVAIL_END - DAY,
    AVAIL_START, AVAIL_END)[0], 'before_window');
});

test('a stale window is Stripe problem, not the interval', () => {
  assert.equal(freshnessState(12)[0], 'fresh');
  assert.equal(freshnessState(35.9)[0], 'fresh');
  const [state, detail] = freshnessState(36);
  assert.equal(state, 'stale');
  assert.match(detail, /defer rather than retry/);
  assert.equal(freshnessState(null)[0], 'unknown');
});
