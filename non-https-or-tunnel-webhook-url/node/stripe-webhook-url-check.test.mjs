import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-webhook-url-check.mjs';

test('a public https url is fine', () => {
  assert.equal(verdict('https://example.com/stripe/webhook', true)[0], 'ok');
});

test('a tunnel host in live mode is flagged', () => {
  const [state, detail] = verdict('https://a1b2.eu.ngrok.io/stripe/webhook', true);
  assert.equal(state, 'tunnel');
  assert.match(detail, /ngrok\.io/);
});

test('the same tunnel host in test mode is not a fault', () => {
  assert.equal(verdict('https://a1b2.eu.ngrok.io/stripe/webhook', false)[0], 'dev');
});

test('a private address is unroutable', () => {
  assert.equal(verdict('https://10.4.1.9/stripe/webhook', true)[0], 'unroutable');
  assert.equal(verdict('http://localhost:4242/webhook', true)[0], 'unroutable');
});

test('plain http on a public host is flagged', () => {
  const [state, detail] = verdict('http://example.com/stripe/webhook', true);
  assert.equal(state, 'plaintext');
  assert.match(detail, /TLS 1\.2/);
});

test('a hostname containing localhost is not flagged', () => {
  assert.equal(verdict('https://localhost-tools.example.com/hook', true)[0], 'ok');
});

test('a missing url is reported, not passed', () => {
  assert.equal(verdict(null, true)[0], 'unparseable');
  assert.equal(verdict('example.com/webhook', true)[0], 'unparseable');
});
