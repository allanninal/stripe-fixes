import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, intervalDays } from './stripe-days-until-due.mjs';

test('charge_automatically is not a finding', () => {
  const [state, detail] = verdict('charge_automatically', null, 30, 0);
  assert.equal(state, 'automatic');
  assert.match(detail, /does not apply/);
});

test('null terms with no invoices yet is unanchored', () => {
  const [state, detail] = verdict('send_invoice', null, 30, 0);
  assert.equal(state, 'unanchored');
  assert.match(detail, /can never age/);
});

test('null terms with undated invoices names the damage', () => {
  const [state, detail] = verdict('send_invoice', null, 30, 7);
  assert.equal(state, 'undated');
  assert.match(detail, /7/);
});

test('zero days is a real term, not a missing one', () => {
  assert.equal(verdict('send_invoice', 0, 30, 0)[0], 'on-receipt');
});

test('terms at or past the billing period overlap', () => {
  assert.equal(verdict('send_invoice', 30, 30, 0)[0], 'overlapping');
  assert.equal(verdict('send_invoice', 29, 30, 0)[0], 'dated');
});

test('an unreadable interval does not invent an overlap', () => {
  assert.equal(verdict('send_invoice', 45, null, 0)[0], 'dated');
});

test('the billing period is read off the first subscription item', () => {
  const sub = { items: { data: [{ price: { recurring: { interval: 'month', interval_count: 3 } } }] } };
  assert.equal(intervalDays(sub), 90);
  assert.equal(intervalDays({ items: { data: [] } }), null);
});
