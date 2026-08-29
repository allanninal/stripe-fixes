/**
 * Report whether a live Stripe key is actually transacting in live mode.
 *
 * Read only. Four GET requests, no writes: give this a RESTRICTED key with read
 * access to Account, Charges, PaymentIntents and Customers. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const TESTMODE = 'testmode_decline';

/**
 * Count objects that failed because a test artefact reached live mode. Pure.
 *
 * Stripe records this one condition in three fields depending on how far the
 * payment got, so reading only one of them under-counts.
 */
export function countTestmodeDeclines(charges, intents) {
  let n = 0;
  for (const c of charges) {
    const outcome = c.outcome ?? {};
    if (c.failure_code === TESTMODE || outcome.reason === TESTMODE) n += 1;
  }
  for (const pi of intents) {
    const err = pi.last_payment_error ?? {};
    if (err.code === TESTMODE) n += 1;
  }
  return n;
}

/**
 * Classify one account. Pure.
 */
export function verdict(keyMode, account, counts) {
  if (keyMode !== 'live') {
    return ['test_key',
      'this is a test-mode key, so it cannot see the live account at all: run ' +
      'it again with a restricted live key'];
  }
  if (!account.details_submitted || !account.charges_enabled) {
    return ['not_activated',
      'activation is unfinished, so the account is limited to test-mode ' +
      `charges: charges_enabled=${account.charges_enabled} ` +
      `details_submitted=${account.details_submitted}`];
  }
  if (counts.testmode_declines) {
    return ['test_cards_live',
      `${counts.testmode_declines} live payment(s) failed with testmode_decline: ` +
      'a test card number or a test-mode object id reached production'];
  }
  const seen = (counts.charges ?? 0) + (counts.payment_intents ?? 0) +
               (counts.customers ?? 0);
  if (!seen) {
    return ['pointed_at_test',
      'the live account holds no charges, intents or customers: the ' +
      'application is transacting in test mode'];
  }
  return ['healthy', 'live objects exist and no testmode_decline in the window'];
}

async function get(key, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (res.status === 403) {
    throw new Error(`403 from Stripe: the restricted key lacks read access to ${path}`);
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const mode = key.includes('_live_') ? 'live' : 'test';
  const account = await get(key, '/account');
  const { data: charges = [] } = await get(key, '/charges', { limit: 100 });
  const { data: intents = [] } = await get(key, '/payment_intents', { limit: 100 });
  const { data: customers = [] } = await get(key, '/customers', { limit: 100 });

  const counts = {
    charges: charges.length,
    payment_intents: intents.length,
    customers: customers.length,
    testmode_declines: countTestmodeDeclines(charges, intents),
  };

  const [state, detail] = verdict(mode, account, counts);
  const line = `${state.padEnd(16)} ${detail}`;
  if (state === 'healthy') { console.log(line); return; }

  console.warn(line);
  if (state === 'test_key') {
    console.warn('  repair: export a restricted key beginning rk_live_ and re-run');
    process.exitCode = 2;
    return;
  }
  if (state === 'not_activated') {
    console.warn('  repair: finish activation at ' +
      'https://dashboard.stripe.com/account/onboarding until charges_enabled is true');
  } else {
    console.warn('  repair: put a matching sk_live_ and pk_live_ pair from the ' +
      'same account on server and client');
    console.warn('  repair: remove hardcoded test-mode ids; resolve prices by ' +
      'lookup_key so one code path works in both modes');
  }
  console.log(`read ${counts.charges} charge(s), ${counts.payment_intents} intent(s), ` +
              `${counts.customers} customer(s) in ${mode} mode`);
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
