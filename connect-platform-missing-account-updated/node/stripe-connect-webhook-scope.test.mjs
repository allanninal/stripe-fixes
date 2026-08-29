import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage } from './stripe-connect-webhook-scope.mjs';

const endpoint = (events, status = 'enabled') => ({
  id: 'we_1', status, url: 'https://example.com/hook', enabled_events: events,
});

test('a plain account is not asked about connect scope', () => {
  const [state, detail] = coverage([endpoint(['charge.succeeded'])], false);
  assert.equal(state, 'not-a-platform');
  assert.match(detail, /no connected accounts/);
});

test('both connect signals present is covered', () => {
  const [state] = coverage(
    [endpoint(['account.updated', 'account.application.deauthorized'])], true);
  assert.equal(state, 'covered');
});

test('neither signal is uncovered', () => {
  const [state, detail] = coverage([endpoint(['charge.succeeded', 'payout.paid'])], true);
  assert.equal(state, 'uncovered');
  assert.match(detail, /account.updated/);
});

test('a disabled endpoint does not count as coverage', () => {
  // A disabled endpoint delivers nothing, so it is the same as not having one.
  const [state, detail] = coverage(
    [endpoint(['charge.succeeded']),
      endpoint(['account.updated', 'account.application.deauthorized'], 'disabled')], true);
  assert.equal(state, 'uncovered');
  assert.match(detail, /1 disabled endpoint\(s\) were ignored/);
});

test('a wildcard is inconclusive rather than covered', () => {
  const [state, detail] = coverage([endpoint(['*'])], true);
  assert.equal(state, 'inconclusive');
  assert.match(detail, /Workbench/);
});

test('account.updated without deauthorized is half a subscription', () => {
  const [state, detail] = coverage([endpoint(['account.updated'])], true);
  assert.equal(state, 'thin');
  assert.match(detail, /disconnect/);
});

test('no enabled endpoint at all says so first', () => {
  const [state, detail] = coverage([endpoint(['*'], 'disabled')], true);
  assert.equal(state, 'no-endpoints');
  assert.match(detail, /nothing is being delivered anywhere/);
});
