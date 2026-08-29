import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, family } from './stripe-dispute-inquiries.mjs';

const NOW = 1_700_000_000;

function inquiry(hoursLeft, evidence = {}) {
  return {
    id: 'du_1',
    status: 'warning_needs_response',
    evidence_details: { due_by: NOW + Math.round(hoursLeft * 3600), ...evidence },
  };
}

test('the warning family is the inquiry side of the line', () => {
  assert.equal(family('warning_needs_response'), 'inquiry');
  assert.equal(family('warning_under_review'), 'inquiry');
  assert.equal(family('warning_closed'), 'inquiry');
});

test('settled chargebacks stay on the chargeback side', () => {
  assert.equal(family('won'), 'chargeback');
  assert.equal(family('lost'), 'chargeback');
  assert.equal(family('needs_response'), 'chargeback');
  assert.equal(family('sleeping'), 'unknown');
});

test('an open inquiry with nothing attached reports days left', () => {
  const [state, detail] = classify(inquiry(240), NOW);
  assert.equal(state, 'unanswered');
  assert.match(detail, /10\.0 day/);
});

test('seventy two hours is the boundary and it is inclusive', () => {
  assert.equal(classify(inquiry(72), NOW)[0], 'critical');
  assert.equal(classify(inquiry(72.1), NOW)[0], 'unanswered');
});

test('staged evidence that was never submitted is its own state', () => {
  const [state, detail] = classify(
    inquiry(240, { has_evidence: true, submission_count: 0 }), NOW);
  assert.equal(state, 'staged');
  assert.match(detail, /submission_count/);
  assert.equal(
    classify(inquiry(240, { has_evidence: true, submission_count: 1 }), NOW)[0],
    'answered');
});

test('an escalated dispute is not reported as an open inquiry', () => {
  const [state, detail] = classify({ status: 'needs_response' }, NOW);
  assert.equal(state, 'escalated');
  assert.match(detail, /fee/);
  assert.equal(classify(inquiry(-1), NOW)[0], 'lapsing');
});
