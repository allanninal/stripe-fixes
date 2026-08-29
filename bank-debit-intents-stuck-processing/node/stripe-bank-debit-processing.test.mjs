import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-bank-debit-processing.mjs';

const NOW = 1700000000;
const DAY = 86400;

const intent = (types, ageDays, status = 'processing') => ({
  status,
  payment_method_types: types,
  created: NOW - Math.round(ageDays * DAY),
});

test('settled intents are ignored', () => {
  assert.equal(
    classify(intent(['us_bank_account'], 30, 'succeeded'), NOW)[0], 'not_processing');
});

test('ACH inside its window is settling', () => {
  const [state, detail] = classify(intent(['us_bank_account'], 3), NOW);
  assert.equal(state, 'settling');
  assert.match(detail, /us_bank_account/);
});

test('SEPA at five days is still settling', () => {
  assert.equal(classify(intent(['sepa_debit'], 5), NOW)[0], 'settling');
});

test('ACH at nine days is stuck', () => {
  const [state, detail] = classify(intent(['us_bank_account'], 9), NOW);
  assert.equal(state, 'stuck');
  assert.match(detail, /not settlement taking its time/);
});

test('several debit types take the most generous window', () => {
  assert.equal(
    classify(intent(['us_bank_account', 'sepa_debit'], 6.5), NOW)[0], 'settling');
});

test('a card left processing is a different failure', () => {
  const [state, detail] = classify(intent(['card'], 4), NOW);
  assert.equal(state, 'non_debit');
  assert.match(detail, /confirmation never completed/);
});
