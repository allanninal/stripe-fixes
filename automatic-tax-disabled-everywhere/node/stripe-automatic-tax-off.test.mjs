import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-automatic-tax-off.mjs';

test('all enabled is clear', () => {
  const [state, detail] = verdict(0, 412, []);
  assert.equal(state, 'on');
  assert.match(detail, /412/);
});

test('off everywhere with EU invoices is the loud case', () => {
  const [state, detail] = verdict(300, 300, ['DE', 'FR', 'de']);
  assert.equal(state, 'exposed');
  assert.match(detail, /DE, FR/);
});

test('a fixed create path with no backfill reads as partial', () => {
  const [state, detail] = verdict(40, 300, ['GB']);
  assert.equal(state, 'partial');
  assert.match(detail, /never backfilled/);
});

test('one domestic country is a question, not a verdict', () => {
  const [state, detail] = verdict(50, 50, ['US']);
  assert.equal(state, 'domestic');
  assert.match(detail, /registrations/);
});

test('no country anywhere cannot be judged', () => {
  const [state, detail] = verdict(50, 50, [null, '']);
  assert.equal(state, 'unknown');
  assert.match(detail, /cannot be judged/);
});
