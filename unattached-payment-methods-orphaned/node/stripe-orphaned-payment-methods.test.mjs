import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-orphaned-payment-methods.mjs';

test('nothing to judge is clear', () => {
  assert.equal(verdict(0, 0, 0, 0)[0], 'clear');
});

test('all attached is clear', () => {
  const [state, detail] = verdict(0, 40, 0, 0);
  assert.equal(state, 'clear');
  assert.match(detail, /attached/);
});

test('a failed reuse outranks every hygiene finding', () => {
  const [state, detail] = verdict(1, 999, 0, 3);
  assert.equal(state, 'burned');
  assert.match(detail, /payment_method_unexpected_state/);
});

test('half the cards orphaned is the live path', () => {
  const [state, detail] = verdict(50, 50, 0, 0);
  assert.equal(state, 'leaking');
  assert.match(detail, /50%/);
});

test('the warn ratio is inclusive', () => {
  assert.equal(verdict(2, 8, 0, 0)[0], 'residue');
  assert.equal(verdict(25, 75, 0, 0)[0], 'orphaned');
});

test('unsaved intents are named even with few orphans', () => {
  const [state, detail] = verdict(3, 97, 12, 0);
  assert.equal(state, 'unsaved');
  assert.match(detail, /setup_future_usage/);
});
