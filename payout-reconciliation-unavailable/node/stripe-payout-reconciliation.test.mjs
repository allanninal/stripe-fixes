import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-payout-reconciliation.mjs';

test('manual payout can never be listed against', () => {
  const [state, detail] = classify(
    { id: 'po_1', amount: 500000, automatic: false,
      reconciliation_status: 'not_applicable' }, null, null);
  assert.equal(state, 'manual');
  assert.match(detail, /itemized report/);
});

test('not_applicable on an automatic payout is different', () => {
  const [state] = classify(
    { id: 'po_2', amount: 500000, automatic: true,
      reconciliation_status: 'not_applicable' }, null, null);
  assert.equal(state, 'unsupported');
});

test('completed payout whose transactions do not add up', () => {
  const [state, detail] = classify(
    { id: 'po_3', amount: 500000, automatic: true,
      reconciliation_status: 'completed' }, 497500, 84);
  assert.equal(state, 'mismatch');
  assert.match(detail, /2500 apart/);
});

test('completed and balanced is the healthy case', () => {
  const [state] = classify(
    { id: 'po_4', amount: 500000, automatic: true,
      reconciliation_status: 'completed' }, 500000, 84);
  assert.equal(state, 'reconciled');
});

test('in_progress is not reported as broken', () => {
  const [state] = classify(
    { id: 'po_5', amount: 500000, automatic: true,
      reconciliation_status: 'in_progress' }, null, null);
  assert.equal(state, 'pending');
});
