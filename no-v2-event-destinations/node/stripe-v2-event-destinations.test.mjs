import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-v2-event-destinations.mjs';

const THIN = { id: 'ed_1', event_payload: 'thin', status: 'enabled' };
const SNAPSHOT = { id: 'ed_2', event_payload: 'snapshot', status: 'enabled' };

test('an enabled thin destination is all that is needed', () => {
  const [state, detail] = verdict([THIN, SNAPSHOT], true);
  assert.equal(state, 'covered');
  assert.match(detail, /ed_1/);
});

test('a thin destination that is disabled delivers nothing', () => {
  const dead = { id: 'ed_3', event_payload: 'thin', status: 'disabled',
                 status_details: 'disabled after repeated 500s' };
  const [state, detail] = verdict([dead], true);
  assert.equal(state, 'disabled');
  assert.match(detail, /repeated 500s/);
});

test('snapshot destinations do not count as coverage', () => {
  const [state, detail] = verdict([SNAPSHOT, SNAPSHOT, SNAPSHOT], true);
  assert.equal(state, 'snapshot-only');
  assert.match(detail, /3 event destination/);
});

test('nothing configured while a v2 feature runs is an outage', () => {
  const [state, detail] = verdict([], true);
  assert.equal(state, 'dropping');
  assert.match(detail, /delivered nowhere/);
});

test('nothing configured and no v2 feature is only a gap', () => {
  assert.equal(verdict([], false)[0], 'none');
  assert.equal(verdict(null, false)[0], 'none');
});
