import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-dead-event-types.mjs';

const FIRED = ['payment_intent.succeeded', 'invoice.paid',
               'customer.source.expiring'];

test('a removed type is rejected', () => {
  const [state, detail] = verdict('invoiceitem.updated', FIRED);
  assert.equal(state, 'rejected');
  assert.match(detail, /update/);
});

test('a silent sources type is dead', () => {
  assert.equal(verdict('source.chargeable', FIRED)[0], 'dead');
});

test('a sources type that still fires is not dead', () => {
  assert.equal(verdict('customer.source.expiring', FIRED)[0], 'legacy');
});

test('silence on a current type is not decay', () => {
  const [state, detail] = verdict('charge.dispute.created', FIRED);
  assert.equal(state, 'quiet');
  assert.match(detail, /low volume/);
});

test('a wildcard has nothing to diff', () => {
  assert.equal(verdict('*', FIRED)[0], 'wildcard');
});
