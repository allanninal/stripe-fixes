import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, isLivemode } from './stripe-live-webhook-endpoints.mjs';

test('no endpoints with payments is the outage', () => {
  const [state, detail] = verdict([], 47, true);
  assert.equal(state, 'blind');
  assert.match(detail, /47/);
});

test('no endpoints and no traffic is a gap not an outage', () => {
  const [state, detail] = verdict([], 0, true);
  assert.equal(state, 'empty');
  assert.match(detail, /before the first real payment/);
});

test('endpoints that are all disabled deliver nothing', () => {
  const eps = [{ status: 'disabled' }, { status: 'disabled' }];
  assert.equal(verdict(eps, 12, true)[0], 'all-disabled');
});

test('a healthy test mode is not a pass', () => {
  const [state, detail] = verdict([{ status: 'enabled' }], 12, false);
  assert.equal(state, 'test-mode');
  assert.match(detail, /live restricted key/);
});

test('an enabled live endpoint is covered', () => {
  assert.equal(verdict([{ status: 'enabled' }], 12, true)[0], 'covered');
});

test('missing status does not count as enabled', () => {
  assert.equal(verdict([{}], 0, true)[0], 'all-disabled');
});

test('key prefix decides the mode', () => {
  assert.equal(isLivemode('rk_live_abc'), true);
  assert.equal(isLivemode('rk_test_abc'), false);
});
