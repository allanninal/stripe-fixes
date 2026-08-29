import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-event-retention.mjs';

test('nothing undelivered is clear', () => {
  assert.equal(verdict(null, 0)[0], 'clear');
});

test('fresh backlog is replayable', () => {
  const [state, detail] = verdict(3.0, 40);
  assert.equal(state, 'replayable');
  assert.match(detail, /27\.0/);
});

test('twenty days is the warning boundary', () => {
  assert.equal(verdict(19.9, 5)[0], 'replayable');
  assert.equal(verdict(20.0, 5)[0], 'aging');
});

test('twenty nine days is the last call', () => {
  assert.equal(verdict(28.9, 5)[0], 'aging');
  const [state, detail] = verdict(29.0, 5);
  assert.equal(state, 'expiring');
  assert.match(detail, /under a day/);
});

test('count without a timestamp is not silently clear', () => {
  assert.equal(verdict(null, 12)[0], 'unknown');
});
