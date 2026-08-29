import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-transfers-capability.mjs';

test('absent capability is unrequested, not inactive', () => {
  const [state, detail] = classify(null);
  assert.equal(state, 'unrequested');
  assert.match(detail, /never requested/);
});

test('active is the only healthy status', () => {
  assert.equal(classify({ status: 'active' })[0], 'active');
});

test('pending is not something to chase', () => {
  const [state, detail] = classify({
    status: 'pending',
    requirements: { pending_verification: ['individual.verification.document'] },
  });
  assert.equal(state, 'verifying');
  assert.match(detail, /does not speed it up/);
});

test('inactive with fields names them', () => {
  const [state, detail] = classify({
    status: 'inactive',
    requirements: { currently_due: ['company.tax_id', 'business_profile.url'] },
  });
  assert.equal(state, 'blocked');
  assert.match(detail, /company\.tax_id/);
});

test('a rejected reason is not a field to collect', () => {
  const [state, detail] = classify({
    status: 'inactive',
    requirements: { currently_due: [], disabled_reason: 'rejected.fraud' },
  });
  assert.equal(state, 'held');
  assert.match(detail, /rejected\.fraud/);
});
