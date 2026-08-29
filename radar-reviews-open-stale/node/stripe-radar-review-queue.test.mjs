import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleHealth, verdict } from './stripe-radar-review-queue.mjs';

test('fresh review is just open', () => {
  const [state, detail] = verdict(1.0, true);
  assert.equal(state, 'open');
  assert.ok(detail.includes('still inside the window'));
});

test('three days is the stale boundary', () => {
  assert.equal(verdict(2.9, true)[0], 'open');
  assert.equal(verdict(3.0, true)[0], 'stale');
});

test('uncaptured hold expires at seven days', () => {
  const [state, detail] = verdict(6.9, false);
  assert.equal(state, 'expiring');
  assert.ok(detail.includes('0.1 day(s)'));
  assert.equal(verdict(7.0, false)[0], 'lapsed');
});

test('captured charge past seven days is critical', () => {
  const [state, detail] = verdict(9.0, true);
  assert.equal(state, 'critical');
  assert.ok(detail.includes('dispute window'));
});

test('approval rate needs a sample before it judges the rule', () => {
  assert.equal(ruleHealth(19, 19)[0], 'insufficient');
  assert.equal(ruleHealth(20, 20)[0], 'overbroad');
  assert.equal(ruleHealth(16, 20)[0], 'wide');
  assert.equal(ruleHealth(8, 20)[0], 'earning');
});
