import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyShape, verdict } from './stripe-idempotency-key-reuse.mjs';

const UUID = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';

test('two requests inside the window is the 409', () => {
  const [state, detail] = verdict(UUID, 2, 30);
  assert.equal(state, 'concurrent');
  assert.match(detail, /409/);
});

test('two requests a day apart is a duplicate not a conflict', () => {
  const [state, detail] = verdict(UUID, 2, 108000);
  assert.equal(state, 'pruned');
  assert.match(detail, /86400/);
});

test('a key built from a customer id is flagged before it collides', () => {
  assert.equal(keyShape('cus_Nc1mzuAyRlKmGT')[0], 'object-id');
  assert.equal(verdict('cus_Nc1mzuAyRlKmGT', 1, 0)[0], 'derived');
});

test('an email address is never an acceptable key', () => {
  const [shape, described] = keyShape('ada@example.com');
  assert.equal(shape, 'personal');
  assert.match(described, /email/);
  assert.equal(verdict('ada@example.com', 1, 0)[0], 'derived');
});

test('a uuid on one request is clean', () => {
  assert.equal(keyShape(UUID)[0], 'uuid');
  assert.equal(verdict(UUID, 1, 0)[0], 'unique');
  assert.equal(keyShape('2026-08-30')[0], 'date');
  assert.equal(keyShape('41231')[0], 'integer');
});
