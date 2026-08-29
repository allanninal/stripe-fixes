import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-settlement-currency.mjs';

const US_SPEC = {
  supported_transfer_countries: ['US', 'GB', 'DE'],
  supported_bank_account_currencies: { usd: ['US'], gbp: ['GB'], eur: ['DE'] },
};
const US = { country: 'US', default_currency: 'usd' };

test('a matching default destination settles', () => {
  const externals = [{ currency: 'usd', default_for_currency: true }];
  assert.equal(verdict(US, externals, US_SPEC)[0], 'settles');
});

test('a matching destination that is not the default is its own finding', () => {
  const [state, detail] = verdict(
    US, [{ currency: 'usd', default_for_currency: false }], US_SPEC);
  assert.equal(state, 'not-default');
  assert.match(detail, /default_for_currency/);
});

test('a wrong currency destination names what is actually attached', () => {
  const [state, detail] = verdict(
    US, [{ currency: 'aud', default_for_currency: true }], US_SPEC);
  assert.equal(state, 'currency-missing');
  assert.match(detail, /AUD/);
  assert.match(detail, /USD/);
});

test('no destination at all is separate from a wrong one', () => {
  assert.equal(verdict(US, [], US_SPEC)[0], 'no-destination');
});

test('an unsupported corridor outranks the currency check', () => {
  const acct = { country: 'BR', default_currency: 'brl' };
  const [state, detail] = verdict(acct, [{ currency: 'aud' }], US_SPEC);
  assert.equal(state, 'unsupported-corridor');
  assert.match(detail, /BR/);
});

test('a country that cannot hold the currency is reported as such', () => {
  const acct = { country: 'GB', default_currency: 'usd' };
  assert.equal(verdict(acct, [{ currency: 'gbp' }], US_SPEC)[0], 'unbankable-currency');
});

test('the corridor checks are skipped without a spec', () => {
  const acct = { country: 'BR', default_currency: 'brl' };
  const externals = [{ currency: 'brl', default_for_currency: true }];
  assert.equal(verdict(acct, externals, null)[0], 'settles');
});

test('a missing default_currency is not silently settling', () => {
  assert.equal(verdict({ country: 'US' }, [{ currency: 'usd' }], null)[0], 'unknown');
});
