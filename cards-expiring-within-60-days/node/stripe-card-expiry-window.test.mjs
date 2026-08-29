import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiresAt, verdict } from './stripe-card-expiry-window.mjs';

test('a card is valid through the end of its month', () => {
  assert.equal(expiresAt(4, 2029), Date.UTC(2029, 4, 1) / 1000);
});

test('december rolls into the next year', () => {
  assert.equal(expiresAt(12, 2026), Date.UTC(2027, 0, 1) / 1000);
});

test('february of a leap year still lands on march', () => {
  assert.equal(expiresAt(2, 2028), Date.UTC(2028, 2, 1) / 1000);
});

test('an expiry already past is a decline that happened', () => {
  const [state, detail] = verdict(-3.0, true);
  assert.equal(state, 'expired');
  assert.match(detail, /billing default/);
});

test('the window edge is inclusive', () => {
  assert.equal(verdict(60.0)[0], 'warn');
  assert.equal(verdict(60.1)[0], 'ok');
});

test('the default card is its own bucket', () => {
  assert.equal(verdict(20.0)[0], 'warn');
  assert.equal(verdict(20.0, true)[0], 'urgent');
});

test('wallet credentials are not warned about', () => {
  const [state, detail] = verdict(10.0, true, 'apple_pay');
  assert.equal(state, 'tokenised');
  assert.match(detail, /reissued/);
});

test('a card with no expiry is not silently fine', () => {
  assert.equal(verdict(null)[0], 'unreadable');
});
