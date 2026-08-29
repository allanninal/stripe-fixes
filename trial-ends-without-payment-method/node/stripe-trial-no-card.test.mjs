import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-trial-no-card.mjs';

const NOW = 1_800_000_000;
const HOUR = 3600;

function trial(hoursOut, behaviour, customer) {
  const sub = { trial_end: NOW + hoursOut * HOUR, customer: customer ?? {} };
  if (behaviour) {
    sub.trial_settings = { end_behavior: { missing_payment_method: behaviour } };
  }
  return sub;
}

test('a card on the subscription is not a finding', () => {
  assert.equal(verdict({ default_payment_method: 'pm_1', customer: {} }, NOW)[0],
    'carded');
});

test('a card on the customer counts too', () => {
  const sub = trial(24, null,
    { invoice_settings: { default_payment_method: 'pm_2' } });
  assert.equal(verdict(sub, NOW)[0], 'carded');
});

test('missing trial settings is read as the stripe default', () => {
  const [state, detail] = verdict(trial(12), NOW);
  assert.equal(state, 'imminent');
  assert.match(detail, /past_due/);
});

test('pause is named as a different outcome', () => {
  const [state, detail] = verdict(trial(12, 'pause'), NOW);
  assert.equal(state, 'imminent');
  assert.match(detail, /paused/);
});

test('a trial ending in three weeks is not imminent', () => {
  const [state, detail] = verdict(trial(24 * 21), NOW);
  assert.equal(state, 'no-card');
  assert.match(detail, /day\(s\)/);
});

test('unexpanded customer is not silently carded', () => {
  const [state, detail] = verdict({ trial_end: NOW + HOUR, customer: 'cus_9' }, NOW);
  assert.equal(state, 'unknown');
  assert.match(detail, /expand/);
});
