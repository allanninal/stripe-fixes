import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-setup-intents-stuck.mjs';

test('an empty window is clear', () => {
  assert.equal(verdict(0, 0, 0, 0)[0], 'clear');
});

test('everything resolved is clear', () => {
  const [state, detail] = verdict(312, 0, 0, 0);
  assert.equal(state, 'clear');
  assert.match(detail, /312/);
});

test('nineteen percent is ordinary drop off', () => {
  assert.equal(verdict(100, 19, 0, 0)[0], 'abandonment');
});

test('twenty percent is a broken path', () => {
  const [state, detail] = verdict(100, 20, 0, 0);
  assert.equal(state, 'no-payment-method');
  assert.match(detail, /last_setup_error/);
});

test('a pile at requires_confirmation names the client', () => {
  const [state, detail] = verdict(100, 5, 40, 2);
  assert.equal(state, 'unconfirmed');
  assert.match(detail, /confirmSetup/);
});

test('requires_action points at the return_url', () => {
  const [state, detail] = verdict(100, 5, 10, 40);
  assert.equal(state, 'return-url');
  assert.match(detail, /return_url/);
});

test('a tie is broken deterministically', () => {
  assert.equal(verdict(100, 20, 20, 20)[0], 'return-url');
  assert.equal(verdict(100, 20, 20, 0)[0], 'unconfirmed');
});
