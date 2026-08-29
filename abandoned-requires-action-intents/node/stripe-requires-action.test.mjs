import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-requires-action.mjs';

const NOW = 1800000000;

function pi({ status = 'requires_action', ageH = 48, action = 'redirect_to_url' } = {}) {
  const out = { status, created: NOW - ageH * 3600 };
  if (action !== null) out.next_action = { type: action };
  return out;
}

test('old requires_action is abandoned', () => {
  const [state, detail] = classify(pi({ ageH: 48 }), NOW);
  assert.equal(state, 'abandoned');
  assert.match(detail, /redirect_to_url/);
});

test('recent requires_action is not abandoned', () => {
  assert.equal(classify(pi({ ageH: 1 }), NOW)[0], 'in-flight');
});

test('empty next_action is its own state', () => {
  const [state, detail] = classify(pi({ ageH: 48, action: null }), NOW);
  assert.equal(state, 'no-next-action');
  assert.match(detail, /never/);
});

test('other statuses are left alone', () => {
  assert.equal(classify(pi({ status: 'succeeded' }), NOW)[0], 'other');
});

test('missing created is not silently healthy', () => {
  assert.equal(classify({ status: 'requires_action' }, NOW)[0], 'unknown');
});
