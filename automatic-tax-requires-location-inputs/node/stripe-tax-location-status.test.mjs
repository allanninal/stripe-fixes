import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-tax-location-status.mjs';

test('disabled reason outranks the status', () => {
  const [state, detail] = verdict('requires_location_inputs',
    'finalization_requires_location_inputs', true);
  assert.equal(state, 'billed-untaxed');
  assert.match(detail, /no tax and no error/);
});

test('a system error disable is its own state', () => {
  assert.equal(verdict(null, 'finalization_system_error', true)[0], 'billed-unpriced');
});

test('requires_location_inputs splits on finalization', () => {
  assert.equal(verdict('requires_location_inputs', null, false)[0], 'blocked');
  const [state, detail] = verdict('requires_location_inputs', null, true);
  assert.equal(state, 'frozen');
  assert.match(detail, /no longer be changed/);
});

test('failed is Stripe side and wants a retry', () => {
  const [state, detail] = verdict('failed', null, true);
  assert.equal(state, 'failed');
  assert.match(detail, /retry/);
});

test('complete is not a location problem', () => {
  const [state, detail] = verdict('complete', null, true);
  assert.equal(state, 'complete');
  assert.match(detail, /registration/);
});

test('an unrecognised status is not silently complete', () => {
  assert.equal(verdict(null, null, true)[0], 'unknown');
  assert.equal(verdict('pending', null, true)[0], 'unknown');
});
