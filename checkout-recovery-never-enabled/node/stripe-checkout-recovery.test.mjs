import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-checkout-recovery.mjs';

const NOW = 1_700_000_000;
const DAY = 86400;

const expiredSession = (recovery = {}) => ({
  after_expiration: {
    recovery: {
      enabled: true,
      url: 'https://checkout.stripe.com/c/pay/cs_test_x',
      expires_at: NOW + 10 * DAY,
      ...recovery,
    },
  },
  consent: { promotions: 'opt_in' },
});

test('recovery never enabled is the default finding', () => {
  const [state, detail] = verdict({}, NOW);
  assert.equal(state, 'no-recovery');
  assert.match(detail, /never will/);
});

test('live url with consent is recoverable', () => {
  const [state, detail] = verdict(expiredSession(), NOW);
  assert.equal(state, 'recoverable');
  assert.match(detail, /10\.0/);
});

test('a url past its own expiry is not recoverable', () => {
  const [state, detail] = verdict(expiredSession({ expires_at: NOW - 2 * DAY }), NOW);
  assert.equal(state, 'lapsed');
  assert.match(detail, /2\.0/);
});

test('a live url without consent is its own state', () => {
  const session = expiredSession();
  session.consent = { promotions: null };
  const [state, detail] = verdict(session, NOW);
  assert.equal(state, 'no-consent');
  assert.match(detail, /permission/);
});

test('enabled but urlless is not silently recoverable', () => {
  assert.equal(verdict(expiredSession({ url: null }), NOW)[0], 'unknown');
  assert.equal(verdict(expiredSession({ url: '  ' }), NOW)[0], 'unknown');
});
