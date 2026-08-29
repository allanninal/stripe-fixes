/**
 * Report PaymentIntents that pin payment_method_types instead of using dynamic
 * payment methods, and enabled methods that never reach a customer.
 *
 * Read only. Two GET requests, no writes: give this a RESTRICTED key with read
 * access to PaymentIntents and Payment Method Configurations. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// "card" alone is the classic tutorial line; "card" plus "link" is what it
// becomes after Link is switched on and the array is edited rather than removed.
const CARD_ONLY = new Set(['card', 'card,link']);

/**
 * True when this intent pinned an explicit card-only method list. Pure.
 *
 * Both fields matter: payment_method_types is populated on every intent, so only
 * a missing automatic_payment_methods proves the list was passed in.
 */
export function isCardOnly(intent) {
  if (intent.automatic_payment_methods) return false;
  const types = [...(intent.payment_method_types ?? [])].sort();
  return CARD_ONLY.has(types.join(','));
}

/**
 * Method names that are available and switched on for this account. Pure.
 *
 * Read display_preference.value, the resolved setting, not preference.
 */
export function enabledMethods(configs) {
  const out = new Set();
  for (const cfg of configs) {
    for (const [name, val] of Object.entries(cfg)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      const pref = val.display_preference ?? {};
      if (val.available && pref.value === 'on') out.add(name);
    }
  }
  return out;
}

/**
 * Weigh the intents against the account's enabled methods. Pure.
 */
export function verdict(stats, enabled) {
  const total = stats.intents ?? 0;
  if (!total) return ['no_data', 'no PaymentIntents in the window: nothing to judge'];

  const cardOnly = stats.card_only ?? 0;
  const offered = new Set(stats.offered ?? []);
  const unused = [...enabled].filter((m) => !offered.has(m)).sort();

  if (cardOnly >= total * 0.8) {
    return ['hardcoded',
      `${cardOnly} of ${total} intent(s) pin payment_method_types to card, so ` +
      'dynamic payment methods are bypassed. Enabled and never offered: ' +
      (unused.join(', ') || '(nothing else)')];
  }
  if (cardOnly) {
    return ['partial',
      `${cardOnly} of ${total} intent(s) still pin payment_method_types: one ` +
      'creation site was migrated and another was not'];
  }
  if (unused.length) {
    return ['unused',
      `dynamic methods are on everywhere, but ${unused.join(', ')} never ` +
      'appeared on an intent: check currency, country and amount eligibility'];
  }
  return ['healthy', 'every enabled method reaches at least one intent'];
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

export async function sampleIntents(key, since, cap = 2000) {
  const stats = { intents: 0, card_only: 0 };
  const offered = new Set();
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/payment_intents', params);
    const rows = page.data ?? [];
    for (const pi of rows) {
      stats.intents += 1;
      if (isCardOnly(pi)) stats.card_only += 1;
      for (const t of pi.payment_method_types ?? []) offered.add(t);
    }
    if (!rows.length || !page.has_more || stats.intents >= cap) break;
    params.starting_after = rows[rows.length - 1].id;
  }
  stats.offered = offered;
  return stats;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  const stats = await sampleIntents(key, since);
  const { data: configs = [] } = await get(key, '/payment_method_configurations',
                                           { limit: 100 });
  const enabled = enabledMethods(configs);

  const [state, detail] = verdict(stats, enabled);
  const line = `${state.padEnd(9)} ${detail}`;
  if (state === 'healthy' || state === 'no_data') { console.log(line); return; }

  console.warn(line);
  if (state === 'hardcoded' || state === 'partial') {
    console.warn('  repair: drop payment_method_types from the create call');
    console.warn(`  repair: POST ${API}/payment_intents -d amount=1099 ` +
      '-d currency=eur -d "automatic_payment_methods[enabled]=true"');
    console.warn('  repair: use excluded_payment_method_types for one-off ' +
      'exclusions rather than an allowlist');
  } else {
    console.warn('  repair: confirm currency, country and amount eligibility at ' +
      'https://dashboard.stripe.com/settings/payment_methods');
  }
  console.log(`sampled ${stats.intents} intent(s); offered ${stats.offered.size} ` +
              `method(s); enabled ${enabled.size}`);
  process.exitCode = 1;
}

// Only run when invoked directly, so importing this module from the test file
// does not execute main() and fail the suite on the missing key.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
