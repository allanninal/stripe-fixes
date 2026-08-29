import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runState, verdict } from './stripe-report-runs.mjs';

test('succeeded run is not flagged', () => {
  assert.equal(runState('succeeded', 120)[0], 'succeeded');
});

test('pending becomes stalled at the hour', () => {
  assert.equal(runState('pending', 3599)[0], 'running');
  const [state, detail] = runState('pending', 3600);
  assert.equal(state, 'stalled');
  assert.match(detail, /1\.0 hour/);
});

test('failed run without an error string still says something', () => {
  const [state, detail] = runState('failed', 30, null);
  assert.equal(state, 'failed');
  assert.match(detail, /no error message/);
});

test('all successful but a missing day is not clear', () => {
  const [state, detail] = verdict(Array(29).fill('succeeded'), ['2026-08-14'], true);
  assert.equal(state, 'gaps');
  assert.match(detail, /2026-08-14/);
});

test('no runs at all is the loudest case', () => {
  assert.equal(verdict([], [], true)[0], 'silent');
  assert.equal(verdict(['succeeded'], [], false)[0], 'unwatched');
  assert.equal(verdict(['succeeded'], [], true)[0], 'clear');
});
