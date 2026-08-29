import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, periodBounds } from './stripe-metered-usage.mjs';

test('usage present is reporting', () => {
  const [state, detail] = verdict(41208, 12, 300, 0);
  assert.equal(state, 'reporting');
  assert.ok(detail.includes('41,208'));
});

test('a fresh period is not a fault', () => {
  assert.equal(verdict(0, 0, 2, 0)[0], 'early');
  assert.equal(verdict(0, 0, 6, 0)[0], 'silent');
});

test('no summaries points at the event name', () => {
  const [state, detail] = verdict(0, 0, 240, 0);
  assert.equal(state, 'silent');
  assert.ok(detail.includes('event_name'));
});

test('rows that aggregate to zero point at the value key', () => {
  const [state, detail] = verdict(0, 9, 240, 0);
  assert.equal(state, 'zero-valued');
  assert.ok(detail.includes('value_settings.event_payload_key'));
});

test('already billed cycles escalate and keep the cause', () => {
  const [state, detail] = verdict(0, 9, 240, 4);
  assert.equal(state, 'billed-zero');
  assert.ok(detail.includes('4 closed invoice(s)'));
  assert.ok(detail.includes('value_settings.event_payload_key'));
});

test('the item period wins over the subscription period', () => {
  const bounds = periodBounds({ current_period_start: 1, current_period_end: 2 },
                              { current_period_start: 10, current_period_end: 20 });
  assert.deepEqual(bounds, [10, 20]);
});
