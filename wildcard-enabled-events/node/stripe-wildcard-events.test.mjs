import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-wildcard-events.mjs';

const FIRED = ['payment_intent.succeeded', 'charge.refunded', 'invoice.paid'];

test('literal star is a wildcard', () => {
  const [state, detail] = verdict(['*'], FIRED);
  assert.equal(state, 'wildcard');
  assert.match(detail, /3 distinct/);
});

test('a long explicit list is a wildcard typed out', () => {
  const many = Array.from({ length: 60 }, (_, i) => `evt.${i}`);
  assert.equal(verdict(many, FIRED)[0], 'overbroad');
});

test('subscribed types that never fire are reported', () => {
  const [state, detail] = verdict(
    ['payment_intent.succeeded', 'issuing_card.created'], FIRED);
  assert.equal(state, 'padded');
  assert.match(detail, /issuing_card\.created/);
});

test('a list matching real traffic is focused', () => {
  assert.equal(verdict(FIRED, FIRED)[0], 'focused');
});

test('empty enabled_events is not focused', () => {
  assert.equal(verdict([], FIRED)[0], 'empty');
});
