/**
 * Report Stripe payments with no Customer attached, and the repeat buyers in them.
 *
 * Read only. Two paginated GETs, no writes: give this a RESTRICTED key with read
 * access to PaymentIntents and Charges. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Share of orphaned intents above which guest checkout is the default path.
export const DOMINANT = 0.5;

/**
 * Classify the window. Pure, so the ordering can be tested without a network.
 *
 * `repeatFingerprints` outranks the share on purpose: a share is an argument
 * about how much guest checkout you meant to have, and a repeat fingerprint is a
 * named buyer whose history Stripe was not allowed to keep.
 */
export function verdict(total, orphans, repeatFingerprints) {
  if (!total) return ['unknown', 'no payment intents in the window; nothing to judge'];
  const share = orphans / total;
  if (repeatFingerprints) {
    return ['repeat',
      `${repeatFingerprints} card(s) paid more than once with no customer attached. ` +
      'Those are returning buyers scored as strangers every time.'];
  }
  if (share >= DOMINANT) {
    return ['dominant',
      `${orphans} of ${total} payment intent(s), ${Math.round(share * 100)}%, have ` +
      'no customer. Guest checkout is the default path, not an option.'];
  }
  if (orphans) {
    return ['guests',
      `${orphans} of ${total} payment intent(s) have no customer. Expected if guest ` +
      'checkout is deliberate; costly if it is not.'];
  }
  return ['clear', `${total} payment intent(s), 0 with no customer attached`];
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

async function* pageAll(key, path, limit, params = {}) {
  let seen = 0;
  const p = { ...params, limit: 100 };
  for (;;) {
    const page = await get(key, path, p);
    const data = page.data ?? [];
    for (const obj of data) { yield obj; seen += 1; }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
    p.starting_after = data[data.length - 1].id;
  }
}

/**
 * Group customerless successful charges by card fingerprint. The fingerprint is
 * stable for one card across payments and not across a reissue, which makes this
 * an undercount rather than a guess.
 */
export async function repeatCards(key, since, limit = 5000) {
  const counts = new Map();
  for await (const ch of pageAll(key, '/charges', limit, { 'created[gte]': since })) {
    if (ch.customer || ch.status !== 'succeeded') continue;
    const fp = ch.payment_method_details?.card?.fingerprint;
    if (fp) counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }
  return new Map([...counts].filter(([, n]) => n > 1));
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const since = Math.floor(Date.now() / 1000) - 90 * 86400;

  let total = 0;
  let orphans = 0;
  let orphanAmount = 0;
  let unsaveable = 0;
  for await (const pi of pageAll(key, '/payment_intents', 5000, { 'created[gte]': since })) {
    total += 1;
    if (pi.customer) continue;
    orphans += 1;
    orphanAmount += pi.amount ?? 0;
    if (!pi.setup_future_usage) unsaveable += 1;
  }

  const repeats = await repeatCards(key, since);
  const [state, detail] = verdict(total, orphans, repeats.size);

  const line = `${state.padEnd(11)} ${detail}`;
  if (state === 'clear' || state === 'unknown') { console.log(line); return; }

  console.warn(line);
  console.warn(`  ${orphanAmount} in the smallest currency unit is unattributed to anyone`);
  console.warn(`  ${unsaveable} of the orphans also had no setup_future_usage, so the ` +
               'card was discarded too');
  for (const [fp, n] of [...repeats].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.warn(`  fingerprint ${fp} paid ${n} times as a stranger`);
  }
  console.warn('  repair: look the customer up before creating the intent');
  console.warn(`  POST ${API}/payment_intents -d customer=cus_XXX -d setup_future_usage=off_session`);
  console.warn('  in Checkout: pass an existing customer, or customer_creation=always');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
