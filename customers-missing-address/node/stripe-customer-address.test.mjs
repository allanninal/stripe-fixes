import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressState, verdict } from './stripe-customer-address.mjs';

test('absent address is missing', () => {
  assert.equal(addressState({ id: 'cus_1' }), 'missing');
  assert.equal(addressState({ address: null }), 'missing');
});

test('address object with every field null is missing not partial', () => {
  const empty = {
    line1: null, line2: null, city: null,
    state: null, postal_code: null, country: null,
  };
  assert.equal(addressState({ address: empty }), 'missing');
});

test('street and city without a country still fails tax', () => {
  const addr = { line1: '12 Rue de Rivoli', city: 'Paris', postal_code: '75001' };
  assert.equal(addressState({ address: addr }), 'no_country');
});

test('country without a postal code fails avs', () => {
  assert.equal(addressState({ address: { country: 'US', city: 'Denver' } }),
    'no_postal_code');
});

test('a complete address is complete', () => {
  const addr = { line1: '1 Main St', city: 'Denver', postal_code: '80202', country: 'US' };
  assert.equal(addressState({ address: addr }), 'complete');
});

test('a failed finalization outranks any percentage', () => {
  const [state, detail] = verdict(1000, 1, 0, 3);
  assert.equal(state, 'failing');
  assert.match(detail, /3/);
});

test('subscribed customers outrank the overall share', () => {
  assert.equal(verdict(1000, 4, 4, 0)[0], 'billing');
});

test('a quarter incomplete is a collection problem', () => {
  assert.equal(verdict(1000, 249, 0, 0)[0], 'residue');
  assert.equal(verdict(1000, 250, 0, 0)[0], 'widespread');
});

test('no customers is not silently clear', () => {
  assert.equal(verdict(0, 0, 0, 0)[0], 'unknown');
});
