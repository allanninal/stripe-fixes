import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedOn, personRef, verdict } from './stripe-person-requirements.mjs';

test('person reference yields the id before the first dot', () => {
  assert.equal(personRef('person_1MqEZ2eZvKYlo2C.verification.document'),
               'person_1MqEZ2eZvKYlo2C');
});

test('ordinary account fields are not person references', () => {
  assert.equal(personRef('business_profile.url'), null);
  assert.equal(personRef(undefined), null);
});

test('past_due outranks currently_due', () => {
  const [state, detail] = verdict({
    requirements: { past_due: ['dob.day'], currently_due: ['dob.day', 'id_number'] },
  });
  assert.equal(state, 'past-due');
  assert.match(detail, /dob\.day/);
});

test('currently_due names the fields', () => {
  const [state, detail] = verdict({ requirements: { currently_due: ['id_number'] } });
  assert.equal(state, 'blocking');
  assert.match(detail, /id_number/);
});

test('pending verification is not something to collect', () => {
  assert.equal(verdict({ verification: { status: 'pending' } })[0], 'verifying');
});

test('missing verification status is not silently clear', () => {
  assert.equal(verdict({})[0], 'unknown');
});

test('account requirements resolve to a deduplicated person list', () => {
  const acct = { requirements: {
    past_due: ['person_1A.verification.document'],
    currently_due: ['person_1A.verification.document', 'person_1B.dob.day',
                    'business_profile.url'],
  } };
  assert.deepEqual(blockedOn(acct), ['person_1A', 'person_1B']);
});
