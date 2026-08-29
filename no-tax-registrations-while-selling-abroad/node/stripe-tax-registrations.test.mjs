import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-tax-registrations.mjs';

const REGISTERED = new Set(['DE', 'GB', 'US-CA']);
const EXPIRED = new Set(['FR']);

test('a registered country is covered', () => {
  const [state, detail] = verdict('DE', REGISTERED, EXPIRED, 4200000, 214);
  assert.equal(state, 'covered');
  assert.ok(detail.includes('214 paid invoice(s)'));
});

test('an expired registration is its own finding', () => {
  const [state, detail] = verdict('FR', REGISTERED, EXPIRED, 50000, 9);
  assert.equal(state, 'lapsed');
  assert.ok(detail.includes('expired'));
});

test('small revenue in a new country is still reported', () => {
  assert.equal(verdict('NO', REGISTERED, EXPIRED, 12000, 3)[0], 'unregistered');
});

test('large revenue escalates to exposed', () => {
  assert.equal(verdict('AU', REGISTERED, EXPIRED, 999999, 40)[0], 'unregistered');
  assert.equal(verdict('AU', REGISTERED, EXPIRED, 1000000, 40)[0], 'exposed');
});

test('one US state does not cover another', () => {
  assert.equal(verdict('US-CA', REGISTERED, EXPIRED, 800000, 60)[0], 'covered');
  assert.equal(verdict('US-NY', REGISTERED, EXPIRED, 800000, 60)[0], 'unregistered');
});
