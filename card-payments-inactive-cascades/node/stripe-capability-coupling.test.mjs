import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unionDue, verdict } from './stripe-capability-coupling.mjs';

test('both active is healthy', () => {
  assert.equal(verdict({ card_payments: 'active', transfers: 'active' })[0], 'healthy');
});

test('an active transfers is still down when card_payments is inactive', () => {
  const [state, detail] = verdict({ card_payments: 'inactive', transfers: 'active' });
  assert.equal(state, 'coupled-down');
  assert.match(detail, /card_payments/);
  assert.match(detail, /transfers/);
});

test('the coupling runs the other way too', () => {
  const [state, detail] = verdict({ card_payments: 'active', transfers: 'inactive' });
  assert.equal(state, 'coupled-down');
  assert.match(detail, /transfers is inactive/);
});

test('one capability alone is not a coupling problem', () => {
  assert.equal(verdict({ transfers: 'inactive' })[0], 'uncoupled');
  assert.equal(verdict({})[0], 'uncoupled');
});

test('pending is separated from inactive', () => {
  assert.equal(verdict({ card_payments: 'pending', transfers: 'active' })[0],
               'coupled-pending');
});

test('an unrecognised status is not silently healthy', () => {
  assert.equal(verdict({ card_payments: 'revoked', transfers: 'active' })[0], 'unknown');
});

test('the union keeps fields owed by a capability you do not use', () => {
  const caps = [
    { id: 'transfers', requirements: { currently_due: [] } },
    { id: 'card_payments',
      requirements: { currently_due: ['business_profile.mcc'],
                      past_due: ['business_profile.url'] } },
  ];
  assert.deepEqual(unionDue(caps), [
    ['business_profile.mcc', ['card_payments']],
    ['business_profile.url', ['card_payments']],
  ]);
});

test('a field owed by both names both', () => {
  const caps = [
    { id: 'transfers', requirements: { currently_due: ['tos_acceptance.date'] } },
    { id: 'card_payments', requirements: { currently_due: ['tos_acceptance.date'] } },
  ];
  assert.deepEqual(unionDue(caps),
                   [['tos_acceptance.date', ['card_payments', 'transfers']]]);
});
