import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-paused-subscriptions.mjs';

const NOW = 1800000000;
const DAY = 86400;

function sub(daysAgo, { interval = 'month', count = 1, ...extra } = {}) {
  return {
    id: 'sub_1',
    status: 'paused',
    trial_end: NOW - daysAgo * DAY,
    items: { data: [{ price: { recurring: { interval, interval_count: count } } }] },
    ...extra,
  };
}

test('a card on file beats age', () => {
  assert.equal(verdict(sub(400, { default_payment_method: 'pm_1' }), NOW)[0],
    'resumable');
});

test('a customer default counts as a card', () => {
  const customer = { invoice_settings: { default_payment_method: 'pm_2' } };
  assert.equal(verdict(sub(400, { customer }), NOW)[0], 'resumable');
});

test('past one billing interval is dead inventory', () => {
  const [state, detail] = verdict(sub(90), NOW);
  assert.equal(state, 'stale');
  assert.match(detail, /90 day/);
});

test('the interval comes from this subscription own price', () => {
  // Two months is stale on a monthly plan and recent on a yearly one.
  assert.equal(verdict(sub(60, { interval: 'year' }), NOW)[0], 'recent');
  assert.equal(verdict(sub(60, { interval: 'month' }), NOW)[0], 'stale');
});

test('only paused is this problem', () => {
  assert.equal(verdict(sub(90, { status: 'active' }), NOW)[0], 'not-paused');
});
