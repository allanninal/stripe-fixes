import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-pending-webhooks.mjs';

test('an empty sample reports nothing rather than dividing by zero', () => {
  assert.equal(verdict(0, 0, 'none', 0)[0], 'empty');
});

test('everything delivered is clear', () => {
  const [state, detail] = verdict(412, 0, 'none', 0);
  assert.equal(state, 'clear');
  assert.match(detail, /412/);
});

test('one type dominating names the branch', () => {
  const [state, detail] = verdict(500, 40, 'invoice.payment_failed', 36);
  assert.equal(state, 'one-branch');
  assert.match(detail, /invoice\.payment_failed/);
});

test('the concentration threshold is inclusive', () => {
  assert.equal(verdict(1000, 100, 'charge.refunded', 80)[0], 'one-branch');
  assert.notEqual(verdict(1000, 100, 'charge.refunded', 79)[0], 'one-branch');
});

test('a majority stuck across types is the endpoint', () => {
  const [state, detail] = verdict(100, 60, 'payment_intent.succeeded', 20);
  assert.equal(state, 'endpoint-wide');
  assert.match(detail, /redirect/);
});

test('a thin spread is load not a bad branch', () => {
  const [state, detail] = verdict(1000, 40, 'payment_intent.succeeded', 12);
  assert.equal(state, 'intermittent');
  assert.match(detail, /under load/);
});
