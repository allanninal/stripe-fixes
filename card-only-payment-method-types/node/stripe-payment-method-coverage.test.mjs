import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCardOnly, enabledMethods, verdict } from './stripe-payment-method-coverage.mjs';

test('bare card list is hardcoded', () => {
  assert.equal(isCardOnly({ payment_method_types: ['card'] }), true);
});

test('card plus link is still hardcoded', () => {
  assert.equal(isCardOnly({ payment_method_types: ['link', 'card'] }), true);
});

test('dynamic intent that resolved to card is not hardcoded', () => {
  assert.equal(isCardOnly({
    automatic_payment_methods: { enabled: true },
    payment_method_types: ['card'],
  }), false);
});

test('a longer explicit list is not flagged', () => {
  assert.equal(isCardOnly({ payment_method_types: ['card', 'ideal'] }), false);
});

test('enabledMethods ignores metadata and off methods', () => {
  const configs = [{
    id: 'pmc_1', object: 'payment_method_configuration', name: 'default',
    card: { available: true, display_preference: { value: 'on' } },
    ideal: { available: true, display_preference: { value: 'off' } },
    klarna: { available: false, display_preference: { value: 'on' } },
  }];
  assert.deepEqual([...enabledMethods(configs)], ['card']);
});

test('mostly hardcoded names the methods going to waste', () => {
  const stats = { intents: 100, card_only: 95, offered: ['card'] };
  const [state, detail] = verdict(stats, new Set(['card', 'ideal', 'klarna']));
  assert.equal(state, 'hardcoded');
  assert.match(detail, /ideal, klarna/);
});

test('a minority is a half finished migration', () => {
  const stats = { intents: 100, card_only: 12, offered: ['card', 'ideal'] };
  assert.equal(verdict(stats, new Set(['card', 'ideal']))[0], 'partial');
});

test('nothing hardcoded but a method never offered is eligibility', () => {
  const stats = { intents: 100, card_only: 0, offered: ['card'] };
  const [state, detail] = verdict(stats, new Set(['card', 'klarna']));
  assert.equal(state, 'unused');
  assert.match(detail, /eligibility/);
});

test('full coverage is healthy', () => {
  const stats = { intents: 40, card_only: 0, offered: ['card', 'ideal'] };
  assert.equal(verdict(stats, new Set(['card', 'ideal']))[0], 'healthy');
});

test('an empty window is not reported as healthy', () => {
  assert.equal(verdict({ intents: 0 }, new Set(['card']))[0], 'no_data');
});
