/**
 * Report Stripe PaymentMethods that were never attached to a Customer.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access
 * to PaymentMethods and PaymentIntents. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const MIN_AGE_HOURS = 24; // younger than this is a checkout in progress
const WARN_RATIO = 0.25;
const HIGH_RATIO = 0.50;

/**
 * Classify the orphan population. Pure, so the ratios can be tested offline.
 * Returns [state, detail].
 */
export function verdict(orphans, attached, unsavedIntents, reuseErrors) {
  const total = orphans + attached;
  if (reuseErrors) {
    return ['burned',
      `${reuseErrors} PaymentIntent(s) failed with payment_method_unexpected_state: ` +
      `a consumed pm_ is already being charged a second time. ${orphans} orphan(s) ` +
      'on the account.'];
  }
  if (!total) {
    return ['clear', `no card PaymentMethods older than ${MIN_AGE_HOURS} hours to judge`];
  }
  const ratio = orphans / total;
  const pct = (ratio * 100).toFixed(0);
  if (ratio >= HIGH_RATIO) {
    return ['leaking',
      `${orphans} of ${total} card PaymentMethods (${pct}%) were never attached. ` +
      'This is the current behaviour of the checkout, not old residue.'];
  }
  if (unsavedIntents) {
    return ['unsaved',
      `${unsavedIntents} PaymentIntent(s) charged a known customer with ` +
      `setup_future_usage unset, so those cards were discarded after one use. ` +
      `${orphans} orphan(s) so far.`];
  }
  if (ratio >= WARN_RATIO) {
    return ['orphaned',
      `${orphans} of ${total} card PaymentMethods (${pct}%) have no customer. ` +
      'Reusing any of them will fail.'];
  }
  if (orphans) {
    return ['residue',
      `${orphans} of ${total} card PaymentMethods have no customer. Small enough ` +
      'to be history rather than the live path.'];
  }
  return ['clear', 'every card PaymentMethod in the window is attached to a customer'];
}

async function get(key, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export async function pageAll(key, path, limit, params = {}) {
  const out = [];
  const q = { limit: 100, ...params };
  for (;;) {
    const page = await get(key, path, q);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) return out;
    q.starting_after = data[data.length - 1].id;
  }
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const cutoff = Date.now() / 1000 - MIN_AGE_HOURS * 3600;
  let orphans = 0;
  let attached = 0;
  const sample = [];
  for (const pm of await pageAll(key, '/payment_methods', 2000, { type: 'card' })) {
    if (pm.customer) attached += 1;
    else if ((pm.created ?? 0) < cutoff) {
      orphans += 1;
      if (sample.length < 5) sample.push(pm.id);
    }
  }

  let unsaved = 0;
  let reuseErrors = 0;
  for (const pi of await pageAll(key, '/payment_intents', 2000)) {
    if (pi.customer && !pi.setup_future_usage) unsaved += 1;
    if (pi.last_payment_error?.code === 'payment_method_unexpected_state') reuseErrors += 1;
  }

  const [state, detail] = verdict(orphans, attached, unsaved, reuseErrors);
  const line = `${state.padEnd(9)} ${detail}`;
  if (state === 'clear') { console.log(line); return; }

  console.warn(line);
  for (const id of sample) console.warn(`  orphan ${id}`);
  console.warn('  save the card as part of the payment rather than storing the id:');
  console.warn(`  POST ${API}/payment_intents -d customer=cus_X -d setup_future_usage=off_session`);
  console.warn('  to store a card without charging it:');
  console.warn(`  POST ${API}/setup_intents -d customer=cus_X -d usage=off_session`);
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
