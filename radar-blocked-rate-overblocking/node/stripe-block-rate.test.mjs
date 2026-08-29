import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-block-rate.mjs';

test('an empty window is not a finding', () => {
  assert.equal(verdict(0, 0)[0], 'no-data');
});

test('a low block rate is normal', () => {
  assert.equal(verdict(1000, 4)[0], 'normal');
});

test('blocks that are all adaptive acceptance are not yours', () => {
  const [state, detail] = verdict(1000, 60, 60);
  assert.equal(state, 'adaptive-only');
  assert.match(detail, /Adaptive Acceptance/);
});

test('a dominant predicate on normal risk charges names the rule', () => {
  const [state, detail] = verdict(1000, 80, 10, [":card_country: != 'US'", 60, 58]);
  assert.equal(state, 'overblocking-rule');
  assert.match(detail, /card_country/);
});

test('a high rate spread across predicates is still elevated', () => {
  assert.equal(verdict(1000, 80, 0, ['amount > 20000', 20, 18])[0], 'elevated');
});

test('a dominant predicate on risky charges is the rule working', () => {
  assert.equal(verdict(1000, 80, 0, ["card_country != 'US'", 60, 4])[0], 'elevated');
});

test('a middling rate is worth watching not paging', () => {
  const [state, detail] = verdict(1000, 30);
  assert.equal(state, 'watch');
  assert.match(detail, /series/);
});
