import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, subscribedEvents } from './stripe-subscription-deleted-events.mjs';

test('an account without subscriptions is not a finding', () => {
  assert.equal(verdict([], 0, 0)[0], 'not-billing');
});

test('missing with cancellations behind it is a backlog', () => {
  const [state, detail] = verdict(['invoice.paid'], 214, 900);
  assert.equal(state, 'over-entitled');
  assert.match(detail, /214/);
});

test('missing with nothing ended yet is only a gap', () => {
  const [state, detail] = verdict(['invoice.paid'], 0, 40);
  assert.equal(state, 'unsubscribed');
  assert.match(detail, /gap rather than a backlog/);
});

test('deleted without updated is partial', () => {
  const [state, detail] = verdict(['customer.subscription.deleted'], 5, 40);
  assert.equal(state, 'partial');
  assert.match(detail, /customer\.subscription\.updated/);
});

test('both events subscribed is covered', () => {
  const subs = ['customer.subscription.deleted', 'customer.subscription.updated'];
  assert.equal(verdict(subs, 5, 40)[0], 'covered');
});

test('a wildcard covers it and is still called out', () => {
  assert.equal(verdict(['*'], 5, 40)[0], 'wildcard');
});

test('the union flattens every endpoint', () => {
  const union = subscribedEvents([{ enabled_events: ['invoice.paid'] },
    { enabled_events: ['customer.subscription.deleted'] }, {}]);
  assert.deepEqual([...union].sort(),
    ['customer.subscription.deleted', 'invoice.paid']);
});
