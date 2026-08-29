import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-payment-link-limits.mjs';

test('a link with no restrictions is uncapped', () => {
  assert.equal(verdict(null)[0], 'uncapped');
  assert.equal(verdict({})[0], 'uncapped');
});

test('a link well inside its cap has headroom', () => {
  const [state, detail] = verdict({ completed_sessions: { limit: 200, count: 42 } });
  assert.equal(state, 'headroom');
  assert.match(detail, /42 of 200/);
});

test('a link at ninety percent is the one worth catching', () => {
  const [state, detail] = verdict({ completed_sessions: { limit: 100, count: 92 } });
  assert.equal(state, 'near-limit');
  assert.match(detail, /closes itself/);
});

test('an exhausted link with no traffic is only housekeeping', () => {
  const r = { completed_sessions: { limit: 50, count: 50 } };
  assert.equal(verdict(r)[0], 'exhausted');
});

test('an exhausted link still being clicked is lost revenue', () => {
  const r = { completed_sessions: { limit: 50, count: 50 } };
  const [state, detail] = verdict(r, 18);
  assert.equal(state, 'exhausted-in-use');
  assert.match(detail, /18 customer/);
});

test('a missing counter is not read as zero', () => {
  assert.equal(verdict({ completed_sessions: { limit: 50 } })[0], 'unknown');
});
