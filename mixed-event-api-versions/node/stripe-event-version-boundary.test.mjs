import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposure, label, verdict } from './stripe-event-version-boundary.mjs';

const NEW = '2025-09-30.clover';
const OLD = '2024-09-30.acacia';
const ev = (api_version, created) => ({ api_version, created });

test('one version across the window is single', () => {
  assert.equal(verdict([ev(NEW, 300), ev(NEW, 200), ev(NEW, 100)])[0], 'single');
});

test('a missing version is bucketed not dropped', () => {
  assert.equal(label(null), 'unreported');
  assert.equal(label(''), 'unreported');
  assert.equal(verdict([ev(NEW, 300), ev(null, 200), ev(null, 100)])[0], 'boundary');
});

test('a clean cut reports the transition timestamp', () => {
  const [state, detail] = verdict([ev(NEW, 300), ev(NEW, 200), ev(OLD, 100)]);
  assert.equal(state, 'boundary');
  assert.match(detail, /created=200/);
  assert.ok(detail.includes(OLD) && detail.includes(NEW));
});

test('an upgrade that was rolled back is not a clean cut', () => {
  const [state, detail] = verdict([ev(OLD, 400), ev(NEW, 300), ev(NEW, 200), ev(OLD, 100)]);
  assert.equal(state, 'churn');
  assert.match(detail, /72 hour/);
});

test('one unpinned endpoint means the boundary was delivered', () => {
  assert.equal(exposure([NEW, null])[0], 'inherited');
  assert.equal(exposure([NEW, ''])[0], 'inherited');
  assert.equal(exposure([NEW, OLD])[0], 'pinned');
  assert.equal(exposure([])[0], 'no-endpoints');
});
