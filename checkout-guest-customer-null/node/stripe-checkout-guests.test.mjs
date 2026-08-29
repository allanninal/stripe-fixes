import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailCounts, verdict } from './stripe-checkout-guests.mjs';

const make = (email, extra = {}) => ({
  mode: 'payment',
  customer_creation: 'if_required',
  ...(email === undefined ? {} : { customer_details: { email } }),
  ...extra,
});

test('a session with a customer is linked', () => {
  const [state, detail] = verdict(make('a@example.com', { customer: 'cus_9' }));
  assert.equal(state, 'linked');
  assert.match(detail, /cus_9/);
});

test('the default flag produces a guest', () => {
  const [state, detail] = verdict(make('a@example.com'));
  assert.equal(state, 'guest');
  assert.match(detail, /if_required/);
});

test('the same address twice is a repeat guest', () => {
  const sessions = [make('buyer@example.com'), make('BUYER@example.com')];
  const counts = emailCounts(sessions);
  const [state, detail] = verdict(sessions[0], counts.get('buyer@example.com'));
  assert.equal(state, 'repeat-guest');
  assert.match(detail, /2/);
});

test('a guest with no email is not merely a guest', () => {
  assert.equal(verdict(make())[0], 'anonymous');
  assert.equal(verdict(make('   '))[0], 'anonymous');
});

test('subscription mode and always are not silently guests', () => {
  assert.equal(verdict(make('a@example.com', { mode: 'subscription' }))[0], 'unknown');
  assert.equal(
    verdict(make('a@example.com', { customer_creation: 'always' }))[0], 'unknown');
});
