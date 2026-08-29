import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './stripe-verification-errors.mjs';

test('no errors is clear', () => {
  assert.equal(classify([])[0], 'clear');
  assert.equal(classify(null)[0], 'clear');
});

test('greyscale asks for colour, not for patience', () => {
  const [state, detail] = classify([{
    code: 'verification_document_failed_greyscale',
    reason: 'The document could not be verified because it is greyscale.',
    requirement: 'individual.verification.document',
  }]);
  assert.equal(state, 'document');
  assert.match(detail, /colour/);
});

test('keyed identity is a field edit, not a new file', () => {
  const [state, detail] = classify([{
    code: 'verification_failed_keyed_identity',
    requirement: 'individual.first_name',
  }]);
  assert.equal(state, 'identity');
  assert.match(detail, /not the file/);
});

test('a field code names its requirement', () => {
  const [state, detail] = classify([{
    code: 'invalid_tax_id_format', requirement: 'company.tax_id',
  }]);
  assert.equal(state, 'field');
  assert.match(detail, /company\.tax_id/);
});

test('the website family is matched by prefix', () => {
  const [state, detail] = classify([{
    code: 'invalid_url_website_incomplete_cancellation_policy',
    requirement: 'business_profile.url',
  }]);
  assert.equal(state, 'website');
  assert.match(detail, /force re-verification/);
});

test('an unknown code is unmapped and keeps its reason', () => {
  const [state, detail] = classify([{
    code: 'verification_something_brand_new',
    reason: 'A reason only Stripe knows yet.',
    requirement: 'individual.id_number',
  }]);
  assert.equal(state, 'unmapped');
  assert.match(detail, /A reason only Stripe knows yet\./);
});

test('a blocking document error wins over a website one', () => {
  const [state] = classify([
    { code: 'invalid_url_website_other', requirement: 'business_profile.url' },
    { code: 'verification_document_expired', requirement: 'individual.verification.document' },
  ]);
  assert.equal(state, 'document');
});
