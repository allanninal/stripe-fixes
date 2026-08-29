import { test } from 'node:test';
import assert from 'node:assert/strict';
import { darkWallets, verdict, missingDomains } from './stripe-wallet-domains.mjs';

const healthy = (name = 'example.com') => ({
  domain_name: name, livemode: true, enabled: true,
  apple_pay: { status: 'active' }, google_pay: { status: 'active' },
  link: { status: 'active' }, paypal: { status: 'active' },
});

test('a fully active domain has no dark wallets', () => {
  assert.deepEqual(darkWallets(healthy()), []);
});

test('a dark wallet carries stripe reason', () => {
  const d = healthy();
  d.apple_pay = { status: 'inactive',
                  status_details: { error_message: 'association file not found' } };
  assert.deepEqual(darkWallets(d),
                   [['apple_pay', 'inactive', 'association file not found']]);
});

test('a dark wallet without a message still reports', () => {
  const d = healthy();
  d.link = { status: 'inactive' };
  assert.deepEqual(darkWallets(d), [['link', 'inactive', 'no reason given']]);
});

test('a test mode registration is not a pass', () => {
  const d = healthy();
  d.livemode = false;
  assert.equal(verdict(d)[0], 'test_only');
});

test('a disabled domain is not a pass', () => {
  const d = healthy();
  d.enabled = false;
  assert.equal(verdict(d)[0], 'disabled');
});

test('one dark wallet fails the whole domain', () => {
  const d = healthy();
  d.google_pay = { status: 'inactive' };
  const [state, detail, dark] = verdict(d);
  assert.equal(state, 'dark');
  assert.match(detail, /1/);
  assert.equal(dark.length, 1);
});

test('a live enabled active domain passes', () => {
  assert.equal(verdict(healthy())[0], 'active');
});

test('a subdomain is missing even when the apex is healthy', () => {
  assert.deepEqual(missingDomains([healthy('example.com')],
                                  ['example.com', 'checkout.example.com']),
                   ['checkout.example.com']);
});

test('nothing is missing when every host is registered', () => {
  const registered = [healthy('example.com'), healthy('checkout.example.com')];
  assert.deepEqual(missingDomains(registered, ['checkout.example.com']), []);
});
