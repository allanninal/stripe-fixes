import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-highest-risk-succeeded.mjs';

test('normal risk is out of scope', () => {
  assert.equal(verdict('normal', 'succeeded', true, null)[0], 'baseline');
});

test('unscored charges are called out before anything else', () => {
  assert.equal(verdict('not_assessed', 'succeeded', true, null)[0], 'not_assessed');
  assert.equal(verdict(null, 'succeeded', true, null)[0], 'not_assessed');
});

test('highest risk that did not succeed is the block working', () => {
  const [state, detail] = verdict('highest', 'failed', false, null);
  assert.equal(state, 'stopped');
  assert.ok(detail.includes('the block held'));
});

test('an allow rule is named when it overrode the default', () => {
  const rule = { id: 'rule_123', action: 'allow', predicate: ":ip_country: = 'GB'" };
  const [state, detail] = verdict('highest', 'succeeded', true, rule);
  assert.equal(state, 'allowed');
  assert.ok(detail.includes(":ip_country: = 'GB'"));
});

test('captured with no rule means the default is off', () => {
  assert.equal(verdict('highest', 'succeeded', true, null)[0], 'leaked');
  assert.equal(verdict('highest', 'succeeded', true, 'rule_123')[0], 'leaked');
  assert.equal(verdict('highest', 'succeeded', false, null)[0], 'uncaptured');
});
