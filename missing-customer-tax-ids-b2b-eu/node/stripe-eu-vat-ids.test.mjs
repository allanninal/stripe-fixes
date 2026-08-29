import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, taxCharged } from './stripe-eu-vat-ids.mjs';

test('outside the EU is not a reverse charge question', () => {
  assert.equal(verdict('US', [], 'none', 800, null)[0], 'out-of-scope');
  assert.equal(verdict('', [], 'none', 800, null)[0], 'out-of-scope');
});

test('an EU business with no ID and VAT charged is the finding', () => {
  const [state, detail] = verdict('DE', [], 'none', 1900, null);
  assert.equal(state, 'charged-vat');
  assert.match(detail, /1900/);
});

test('no ID and no VAT is a registration question', () => {
  const [state, detail] = verdict('FR', [], 'none', 0, null);
  assert.equal(state, 'no-id-no-vat');
  assert.match(detail, /registration/);
});

test('reverse charge is checked before the ID list', () => {
  assert.equal(verdict('NL', [], 'reverse', 0, null)[0], 'reverse-charge');
  assert.equal(verdict('NL', [], 'exempt', 0, null)[0], 'exempt');
});

test('an unconfirmed ID is not coverage', () => {
  for (const status of ['unverified', 'unavailable', 'pending']) {
    const [state, detail] = verdict('IT', [{ type: 'eu_vat' }], 'none', 0, status);
    assert.equal(state, 'unverified');
    assert.match(detail, new RegExp(status));
  }
});

test('a verified ID is the only clean result', () => {
  assert.equal(verdict('ES', [{ type: 'eu_vat' }], 'none', 0, 'verified')[0], 'ok');
});

test('tax is summed across every tax line on the invoice', () => {
  assert.equal(taxCharged({ total_taxes: [{ amount: 190 }, { amount: 10 }] }), 200);
  assert.equal(taxCharged({}), 0);
});
