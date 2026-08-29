import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-checkout-reconciliation.mjs';

test('client_reference_id is enough on its own', () => {
  const [state, detail] = verdict(
    { client_reference_id: 'ord_918', payment_status: 'paid' });
  assert.equal(state, 'linked');
  assert.match(detail, /ord_918/);
});

test('metadata full of someone elses keys is not linked', () => {
  const [state] = verdict(
    { metadata: { utm_source: 'newsletter' }, payment_status: 'paid' });
  assert.equal(state, 'orphaned');
});

test('paid and unidentified is worse than abandoned', () => {
  assert.equal(verdict({ payment_status: 'paid' })[0], 'orphaned');
  assert.equal(verdict({ payment_status: 'unpaid' })[0], 'unlinked');
});

test('some expected keys but not all is partial', () => {
  const [state, detail] = verdict(
    { metadata: { order_id: '42' }, payment_status: 'paid' },
    ['order_id', 'user_id']);
  assert.equal(state, 'partial');
  assert.match(detail, /user_id/);
});

test('empty and whitespace references do not count as set', () => {
  assert.equal(
    verdict({ client_reference_id: '', payment_status: 'paid' })[0], 'orphaned');
  assert.equal(
    verdict({ client_reference_id: '   ', payment_status: 'paid' })[0], 'orphaned');
  assert.equal(
    verdict({ metadata: { order_id: ' ' }, payment_status: 'paid' })[0], 'orphaned');
});
