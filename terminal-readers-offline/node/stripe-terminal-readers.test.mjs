import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firmwareOutliers, readerState } from './stripe-terminal-readers.mjs';

const NOW_MS = 1756000000000;
const HOUR = 3600000;

test('a seconds timestamp is refused, not believed', () => {
  const [state, detail] = readerState('online', Math.floor(NOW_MS / 1000), NOW_MS);
  assert.equal(state, 'unknown');
  assert.match(detail, /seconds timestamp/);
});

test('recent check-in on an online reader is fine', () => {
  assert.equal(readerState('online', NOW_MS - HOUR, NOW_MS)[0], 'online');
});

test('stale beats a cheerful status', () => {
  assert.equal(readerState('online', NOW_MS - 5 * HOUR, NOW_MS)[0], 'online');
  const [state, detail] = readerState('online', NOW_MS - 6 * HOUR, NOW_MS);
  assert.equal(state, 'stale');
  assert.match(detail, /status lags reality/);
});

test('offline and wedged are different problems', () => {
  assert.equal(readerState('offline', NOW_MS - HOUR, NOW_MS)[0], 'offline');
  const [state, detail] = readerState('online', NOW_MS - HOUR, NOW_MS,
    'failed', 'reader_timeout');
  assert.equal(state, 'action_failed');
  assert.match(detail, /reader_timeout/);
});

test('firmware outliers need a majority to be outliers from', () => {
  const fleet = [
    { id: 'tmr_1', device_type: 'bbpos_wisepos_e', device_sw_version: '2.24' },
    { id: 'tmr_2', device_type: 'bbpos_wisepos_e', device_sw_version: '2.24' },
    { id: 'tmr_3', device_type: 'bbpos_wisepos_e', device_sw_version: '2.11' },
    { id: 'tmr_4', device_type: 'stripe_s700', device_sw_version: '1.4' },
  ];
  const out = firmwareOutliers(fleet);
  assert.deepEqual(out.map((row) => row[0]), ['tmr_3']);
  assert.equal(out[0][3], '2.24');
});
