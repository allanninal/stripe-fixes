import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-expired-cards.mjs';

test('the expiry month itself is still valid', () => {
  const [state, detail] = verdict(6, 2026, 2026, 6);
  assert.equal(state, 'last-month');
  assert.match(detail, /end of 06\/2026/);
});

test('last month of the same year is expired', () => {
  assert.equal(verdict(5, 2026, 2026, 6)[0], 'expired');
});

test('a previous year is expired whatever the month', () => {
  assert.equal(verdict(12, 2025, 2026, 1)[0], 'expired');
});

test('an expired default is escalated', () => {
  const [state, detail] = verdict(1, 2024, 2026, 6, true);
  assert.equal(state, 'expired-default');
  assert.match(detail, /expired_card/);
});

test('a card with no expiry fields is not silently valid', () => {
  assert.equal(verdict(null, null, 2026, 6)[0], 'unreadable');
});
