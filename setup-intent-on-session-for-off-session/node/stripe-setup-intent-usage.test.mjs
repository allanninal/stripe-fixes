import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-setup-intent-usage.mjs';

test('on_session saves for subscribed customers with declines are the diagnosis', () => {
  const [state, detail] = verdict(500, 40, 12, 7);
  assert.equal(state, 'declining');
  assert.match(detail, /12/);
  assert.match(detail, /7/);
});

test('on_session saves for subscribed customers are flagged before anything fails', () => {
  const [state, detail] = verdict(500, 40, 12, 0);
  assert.equal(state, 'exposed');
  assert.match(detail, /next renewal/);
});

test('on_session saves with no subscribers are only worth a look', () => {
  assert.equal(verdict(500, 40, 0, 0)[0], 'review');
});

test('declines without on_session saves are a different bug', () => {
  const [state, detail] = verdict(500, 0, 0, 31);
  assert.equal(state, 'elsewhere');
  assert.match(detail, /not the cause/);
});

test('all off_session and no declines is clear', () => {
  assert.equal(verdict(500, 0, 0, 0)[0], 'clear');
});

test('an empty window is not silently clear', () => {
  assert.equal(verdict(0, 0, 0, 0)[0], 'unknown');
});
