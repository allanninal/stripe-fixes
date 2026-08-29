import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTestmodeDeclines, verdict } from './stripe-live-mode-check.mjs';

const LIVE = { charges_enabled: true, details_submitted: true };
const BUSY = { charges: 40, payment_intents: 40, customers: 12 };

test('counts a charge that only names it in outcome.reason', () => {
  assert.equal(countTestmodeDeclines([{ outcome: { reason: 'testmode_decline' } }], []), 1);
});

test('counts an intent that never produced a charge', () => {
  const intents = [{ last_payment_error: { code: 'testmode_decline' } }];
  assert.equal(countTestmodeDeclines([], intents), 1);
});

test('ordinary declines are not counted', () => {
  const charges = [{ failure_code: 'card_declined',
                     outcome: { reason: 'insufficient_funds' } }];
  assert.equal(countTestmodeDeclines(charges, []), 0);
});

test('a test key short circuits every other rule', () => {
  const [state, detail] = verdict('test', { charges_enabled: false },
                                  { testmode_declines: 9 });
  assert.equal(state, 'test_key');
  assert.match(detail, /live key/);
});

test('unactivated account outranks the decline count', () => {
  const [state] = verdict('live', { charges_enabled: false, details_submitted: true },
                          { testmode_declines: 3 });
  assert.equal(state, 'not_activated');
});

test('declines on an activated account name the count', () => {
  const [state, detail] = verdict('live', LIVE, { ...BUSY, testmode_declines: 3 });
  assert.equal(state, 'test_cards_live');
  assert.match(detail, /3/);
});

test('an empty live account is not healthy', () => {
  assert.equal(verdict('live', LIVE, { testmode_declines: 0 })[0], 'pointed_at_test');
});

test('busy and clean is healthy', () => {
  assert.equal(verdict('live', LIVE, { ...BUSY, testmode_declines: 0 })[0], 'healthy');
});
