import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-webhook-health.mjs';

test('disabled endpoint is reported regardless of event count', () => {
  const [state, detail] = verdict({ status: 'disabled' }, 0);
  assert.equal(state, 'disabled');
  assert.match(detail, /2xx/);
});

test('enabled and quiet is healthy', () => {
  assert.equal(verdict({ status: 'enabled' }, 0)[0], 'healthy');
});

test('enabled with failures is its own state', () => {
  const [state, detail] = verdict({ status: 'enabled' }, 12);
  assert.equal(state, 'failing');
  assert.match(detail, /12/);
});

test('unknown status is not silently healthy', () => {
  assert.equal(verdict({ status: 'paused' }, 0)[0], 'unknown');
});

test('missing status is not silently healthy', () => {
  assert.equal(verdict({}, 0)[0], 'unknown');
});
