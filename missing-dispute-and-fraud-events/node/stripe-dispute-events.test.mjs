import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-dispute-events.mjs';

test('no dispute subscription with disputes already filed', () => {
  const [state, detail] = verdict(['charge.succeeded'], 7, 0);
  assert.equal(state, 'blind');
  assert.match(detail, /7/);
});

test('no dispute subscription and no disputes yet is only a gap', () => {
  const [state, detail] = verdict(['charge.succeeded'], 0, 0);
  assert.equal(state, 'unsubscribed');
  assert.match(detail, /gap/);
});

test('disputes covered but fraud warnings are not', () => {
  const [state, detail] = verdict(['charge.dispute.created'], 3, 12);
  assert.equal(state, 'fraud-blind');
  assert.match(detail, /12/);
});

test('disputes covered with no warnings seen is still incomplete', () => {
  assert.equal(verdict(['charge.dispute.created'], 3, 0)[0], 'dispute-only');
});

test('both opening signals without the closing one', () => {
  const subs = ['charge.dispute.created', 'radar.early_fraud_warning.created'];
  const [state, detail] = verdict(subs, 3, 2);
  assert.equal(state, 'partial');
  assert.match(detail, /charge\.dispute\.closed/);
});

test('all three is covered', () => {
  const subs = ['charge.dispute.created', 'charge.dispute.closed',
    'radar.early_fraud_warning.created'];
  assert.equal(verdict(subs, 3, 2)[0], 'covered');
});

test('a wildcard is reported before anything else', () => {
  assert.equal(verdict(['*'], 7, 12)[0], 'wildcard');
});
