import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './stripe-checkout-return-urls.mjs';

const RETURN = 'https://example.com/after-checkout?session_id={CHECKOUT_SESSION_ID}';

test('embedded with a return_url is ok', () => {
  const [state] = verdict({ ui_mode: 'embedded_page', return_url: RETURN,
    redirect_on_completion: 'if_required' });
  assert.equal(state, 'ok');
});

test('embedded without a return_url is stranded', () => {
  const [state, detail] = verdict({ ui_mode: 'embedded_page', return_url: null });
  assert.equal(state, 'stranded');
  assert.match(detail, /nowhere/);
  assert.equal(
    verdict({ ui_mode: 'embedded_page', return_url: '  ' })[0], 'stranded');
});

test('never plus a redirect method beats a valid return_url', () => {
  const [state, detail] = verdict({ ui_mode: 'embedded_page', return_url: RETURN,
    redirect_on_completion: 'never', payment_method_types: ['card', 'ideal'] });
  assert.equal(state, 'blocked');
  assert.match(detail, /ideal/);
});

test('hosted success_url without the placeholder is unjoinable', () => {
  const [state, detail] = verdict({ ui_mode: 'hosted_page',
    success_url: 'https://example.com/thanks' });
  assert.equal(state, 'unjoinable');
  assert.match(detail, /CHECKOUT_SESSION_ID/);
  assert.equal(
    verdict({ success_url: 'https://example.com/thanks' })[0], 'unjoinable');
});

test('an unrecognised ui_mode is not silently ok', () => {
  assert.equal(verdict({ ui_mode: 'kiosk' })[0], 'unknown');
});
