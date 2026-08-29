import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-inactive-payment-links.mjs';

test('an active link is live', () => {
  assert.equal(verdict(true, 12)[0], 'live');
});

test('a dead link with recent traffic is the expensive case', () => {
  const [state, detail] = verdict(false, 9);
  assert.equal(state, 'dead-in-use');
  assert.match(detail, /9 time\(s\)/);
});

test('an inactive message softens it but does not clear it', () => {
  const [state, detail] = verdict(false, 9, 'We moved to the new plan page');
  assert.equal(state, 'dead-signposted');
  assert.match(detail, /new plan page/);
});

test('a dead link nobody visits is only housekeeping', () => {
  assert.equal(verdict(false, 0)[0], 'dormant');
});

test('a missing active flag is not read as deactivated', () => {
  assert.equal(verdict(null, 3)[0], 'unknown');
  assert.equal(verdict(undefined, 3)[0], 'unknown');
});
