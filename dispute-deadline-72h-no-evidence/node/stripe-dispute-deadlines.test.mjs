import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-dispute-deadlines.mjs';

const NOW = 1_700_000_000;

function openDispute(hoursLeft, evidence = {}) {
  return {
    id: 'du_1',
    status: 'needs_response',
    evidence_details: { due_by: NOW + Math.round(hoursLeft * 3600), ...evidence },
  };
}

test('deadline inside the window with nothing attached is critical', () => {
  const [state, detail] = verdict(openDispute(6), NOW);
  assert.equal(state, 'critical');
  assert.match(detail, /6\.0 hour/);
});

test('seventy two hours is the boundary and it is inclusive', () => {
  assert.equal(verdict(openDispute(72), NOW)[0], 'critical');
  assert.equal(verdict(openDispute(72.1), NOW)[0], 'open');
});

test('staged evidence that was never submitted is its own state', () => {
  const [state, detail] = verdict(
    openDispute(10, { has_evidence: true, submission_count: 0 }), NOW);
  assert.equal(state, 'staged');
  assert.match(detail, /submission_count/);
});

test('past due while still needing a response is forfeited', () => {
  const [state, detail] = verdict(openDispute(-1, { past_due: true }), NOW);
  assert.equal(state, 'forfeited');
  assert.match(detail, /fee/);
});

test('answered and unreadable disputes are not treated as open', () => {
  assert.equal(verdict({ status: 'under_review' }, NOW)[0], 'submitted');
  assert.equal(
    verdict({ status: 'needs_response', evidence_details: {} }, NOW)[0], 'unknown');
  assert.equal(verdict({ status: 'sleeping' }, NOW)[0], 'unknown');
});
