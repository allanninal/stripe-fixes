import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listensForCompletion, verdict } from './stripe-payment-link-fulfilment.mjs';

const REDIRECT = {
  type: 'redirect',
  redirect: { url: 'https://example.com/after?session_id={CHECKOUT_SESSION_ID}' },
};

test('hosted_confirmation without a webhook fulfils nothing', () => {
  const [state, detail] = verdict(
    { after_completion: { type: 'hosted_confirmation' } }, false);
  assert.equal(state, 'unfulfilled');
  assert.match(detail, /nothing fulfils/);
});

test('the same link with a webhook is only untidy', () => {
  const [state] = verdict(
    { after_completion: { type: 'hosted_confirmation' } }, true);
  assert.equal(state, 'webhook-only');
});

test('a missing after_completion is treated as the default', () => {
  assert.equal(verdict({}, false)[0], 'unfulfilled');
});

test('a redirect without the placeholder is blind', () => {
  const [state, detail] = verdict({ after_completion: {
    type: 'redirect', redirect: { url: 'https://example.com/thanks' } } }, true);
  assert.equal(state, 'blind-redirect');
  assert.match(detail, /CHECKOUT_SESSION_ID/);
});

test('a good redirect still needs the event subscribed', () => {
  assert.equal(verdict({ after_completion: REDIRECT }, true)[0], 'covered');
  assert.equal(verdict({ after_completion: REDIRECT }, false)[0], 'landing-only');
});

test('only enabled endpoints count and a wildcard does', () => {
  assert.equal(
    listensForCompletion([{ status: 'enabled', enabled_events: ['*'] }]), true);
  assert.equal(listensForCompletion([{ status: 'disabled',
    enabled_events: ['checkout.session.completed'] }]), false);
  assert.equal(listensForCompletion([]), false);
});
