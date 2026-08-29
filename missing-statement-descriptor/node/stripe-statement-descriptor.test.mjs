import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-statement-descriptor.mjs';

test('no prefix is the first finding', () => {
  const [state, detail] = verdict(null, ['EXAMPLE STORE']);
  assert.equal(state, 'unset');
  assert.ok(detail.includes('1 distinct'));
  assert.equal(verdict('   ', [])[0], 'unset');
});

test('two flows with two descriptors is fragmentation', () => {
  const [state, detail] = verdict('EXAMPLE',
    ['EXAMPLE STORE', 'EXAMPLE SUBS', 'EXAMPLE STORE']);
  assert.equal(state, 'fragmented');
  assert.ok(detail.includes('2 distinct'));
});

test('a configured prefix with empty descriptors is worse than missing', () => {
  assert.equal(verdict('EXAMPLE', ['', '  ', null])[0], 'blank');
});

test('the format rules are checked at their boundaries', () => {
  assert.equal(verdict('EXAMPLE', ['ABCD'])[0], 'malformed');
  assert.equal(verdict('EXAMPLE', ['ABCDE'])[0], 'consistent');
  assert.equal(verdict('EXAMPLE', ['A'.repeat(23)])[0], 'malformed');
  assert.equal(verdict('EXAMPLE', ['AB 12'])[0], 'malformed');
});

test('a disallowed character is rejected', () => {
  const [state, detail] = verdict('EXAMPLE', ['EXAMPLE<STORE']);
  assert.equal(state, 'malformed');
  assert.ok(detail.includes('disallows'));
});
