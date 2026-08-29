import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-connect-charges-disabled.mjs';

test('enabled account is live', () => {
  assert.equal(classify({ charges_enabled: true, details_submitted: true })[0], 'live');
});

test('never onboarded is not an incident', () => {
  const [state, detail] = classify({ charges_enabled: false, details_submitted: false });
  assert.equal(state, 'never-onboarded');
  assert.match(detail, /never opened/);
});

test('every rejected reason is dashboard only', () => {
  // rejected.* is an open family; matching the prefix rather than a fixed list is
  // the difference between a correct answer and one that ages badly.
  for (const reason of ['rejected.fraud', 'rejected.listed', 'rejected.terms_of_service',
    'rejected.other', 'listed', 'under_review']) {
    const [state, detail] = classify({
      charges_enabled: false,
      details_submitted: true,
      requirements: { disabled_reason: reason, currently_due: ['company.tax_id'] },
    });
    assert.equal(state, 'rejected', reason);
    assert.match(detail, /cannot clear/);
  }
});

test('past due is blocked and names the fields', () => {
  const [state, detail] = classify({
    charges_enabled: false,
    details_submitted: true,
    requirements: {
      disabled_reason: 'requirements.past_due',
      currently_due: ['company.tax_id', 'business_profile.url'],
    },
  });
  assert.equal(state, 'blocked');
  assert.match(detail, /company\.tax_id/);
});

test('pending verification asks nobody for anything', () => {
  const [state, detail] = classify({
    charges_enabled: false,
    details_submitted: true,
    requirements: {
      disabled_reason: 'requirements.pending_verification',
      currently_due: [],
    },
  });
  assert.equal(state, 'waiting');
  assert.match(detail, /does not speed it up/);
});

test('disabled with no explanation is not reported as healthy', () => {
  assert.equal(
    classify({ charges_enabled: false, details_submitted: true, requirements: {} })[0],
    'unknown');
});
