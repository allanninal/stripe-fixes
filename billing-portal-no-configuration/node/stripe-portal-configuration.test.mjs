import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-portal-configuration.mjs';

const DEFAULT = { id: 'bpc_1', is_default: true, active: true };
const EXPLICIT = { id: 'bpc_2', is_default: false, active: true };

test('an active default is all that is needed', () => {
  const [state, detail] = verdict([DEFAULT], 400);
  assert.equal(state, 'configured');
  assert.match(detail, /bpc_1/);
});

test('no configuration with live subscribers is an outage', () => {
  const [state, detail] = verdict([], 400);
  assert.equal(state, 'erroring');
  assert.match(detail, /400/);
});

test('no configuration and no subscribers is only waiting to break', () => {
  assert.equal(verdict([], 0)[0], 'missing');
});

test('an explicit only setup still fails without the id', () => {
  const [state, detail] = verdict([EXPLICIT], 400);
  assert.equal(state, 'explicit-only');
  assert.match(detail, /bpc_2/);
});

test('an inactive default does not count', () => {
  const inactive = { id: 'bpc_3', is_default: true, active: false };
  assert.equal(verdict([inactive], 5)[0], 'inactive-default');
});
