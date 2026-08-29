import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-checkout-abandonment.mjs';

test('no sessions is not a perfect score', () => {
  assert.equal(verdict(0, 0)[0], 'no-data');
});

test('half expired is the boundary', () => {
  assert.equal(verdict(100, 49)[0], 'elevated');
  assert.equal(verdict(100, 50)[0], 'abandoned');
});

test('a quarter expired is only elevated', () => {
  assert.equal(verdict(100, 24)[0], 'normal');
  assert.equal(verdict(100, 25)[0], 'elevated');
});

test('lapsed open sessions are reported even when the share is low', () => {
  const [state, detail] = verdict(100, 4, 3);
  assert.equal(state, 'lapsed');
  assert.match(detail, /3 open session\(s\)/);
});

test('a healthy account still reports the percentage', () => {
  const [state, detail] = verdict(640, 118);
  assert.equal(state, 'normal');
  assert.match(detail, /18\.4%/);
});
