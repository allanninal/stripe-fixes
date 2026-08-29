import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-customers-missing-email.mjs';

test('a full customer list is clear', () => {
  assert.equal(verdict(0, 500, 0, 0, 0)[0], 'clear');
});

test('a dispute outranks everything else', () => {
  const [state, detail] = verdict(1, 5000, 0, 0, 1);
  assert.equal(state, 'disputed');
  assert.match(detail, /receipt/);
});

test('an active subscriber outranks a percentage', () => {
  const [state, detail] = verdict(400, 500, 1, 0, 0);
  assert.equal(state, 'unreachable');
  assert.match(detail, /dunning/);
});

test('a quarter missing is the signup path', () => {
  const [state, detail] = verdict(25, 100, 0, 0, 0);
  assert.equal(state, 'widespread');
  assert.match(detail, /25%/);
});

test('below the ratio is a gap not a path', () => {
  assert.equal(verdict(24, 100, 0, 0, 0)[0], 'gaps');
});

test('guest receipts are reported on a clean customer list', () => {
  const [state, detail] = verdict(0, 500, 0, 12, 0);
  assert.equal(state, 'receiptless');
  assert.match(detail, /receipt_email/);
});
