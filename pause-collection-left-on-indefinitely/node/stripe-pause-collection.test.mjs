import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-pause-collection.mjs';

const NOW = 1800000000;
const DAY = 86400;

test('no pause is collecting', () => {
  assert.equal(verdict({ id: 'sub_1' }, NOW)[0], 'collecting');
  assert.equal(verdict({ id: 'sub_1', pause_collection: null }, NOW)[0], 'collecting');
});

test('indefinite keep_as_draft leaves something to collect', () => {
  const [state, detail] = verdict(
    { pause_collection: { behavior: 'keep_as_draft', resumes_at: null } }, NOW);
  assert.equal(state, 'indefinite');
  assert.match(detail, /drafts/);
});

test('indefinite void throws the invoices away', () => {
  // Same pause, same duration, nothing left to finalise at the end of it.
  assert.equal(
    verdict({ pause_collection: { behavior: 'void', resumes_at: null } }, NOW)[0],
    'unrecoverable');
});

test('a future resumes_at is a pause with an end', () => {
  assert.equal(
    verdict({ pause_collection: { behavior: 'void', resumes_at: NOW + 14 * DAY } },
      NOW)[0],
    'scheduled');
});

test('a past resumes_at still paused is its own oddity', () => {
  const [state, detail] = verdict(
    { pause_collection: { behavior: 'keep_as_draft', resumes_at: NOW - 30 * DAY } },
    NOW);
  assert.equal(state, 'overdue');
  assert.match(detail, /30 day/);
});
