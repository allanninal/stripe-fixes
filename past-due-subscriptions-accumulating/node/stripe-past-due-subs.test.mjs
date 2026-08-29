import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-past-due-subs.mjs';

const NOW = 1_800_000_000;
const DAY = 86400;

const inv = (daysOld, attempts) => ({
  id: 'in_1', created: NOW - daysOld * DAY, attempt_count: attempts,
});

test('a fresh invoice with attempts is live dunning', () => {
  const [state, detail] = verdict({ latest_invoice: inv(3, 2) }, NOW);
  assert.equal(state, 'dunning');
  assert.match(detail, /may recover/);
});

test('an old invoice is parked not dunning', () => {
  const [state, detail] = verdict({ latest_invoice: inv(75, 4) }, NOW);
  assert.equal(state, 'parked');
  assert.match(detail, /nothing further will happen/);
});

test('zero attempts is its own fault not a retry problem', () => {
  const [state, detail] = verdict({ latest_invoice: inv(40, 0) }, NOW);
  assert.equal(state, 'never-attempted');
  assert.match(detail, /no payment method/);
});

test('unexpanded invoice is not classified', () => {
  const [state, detail] = verdict({ latest_invoice: 'in_1' }, NOW);
  assert.equal(state, 'unknown');
  assert.match(detail, /expand/);
});

test('invoice without a timestamp is not classified', () => {
  assert.equal(verdict({ latest_invoice: { attempt_count: 3 } }, NOW)[0], 'unknown');
});
