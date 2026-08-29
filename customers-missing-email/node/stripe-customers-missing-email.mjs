/**
 * Report Stripe customers with no email, so no receipt or dunning notice is sent.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access
 * to Customers, Subscriptions and Charges. The repair is printed only.
 */
const API = 'https://api.stripe.com/v1';

export const WIDESPREAD_RATIO = 0.25; // a quarter is a signup path, not a backlog

/**
 * Classify the email gap. Pure, so the ordering can be tested offline.
 * The order is deliberate: money already lost outranks money about to be lost,
 * which outranks a percentage. Returns [state, detail].
 */
export function verdict(missing, total, withActiveSub, receiptlessCharges, disputed) {
  if (disputed) {
    return ['disputed',
      `${disputed} charge(s) from customers with no email have been disputed. ` +
      'The cardholder had no receipt to recognise the descriptor by.'];
  }
  if (withActiveSub) {
    return ['unreachable',
      `${withActiveSub} customer(s) with an active subscription have no email. ` +
      'When the renewal fails, dunning has nowhere to send anything.'];
  }
  if (!total) return ['clear', 'no customers in the window'];
  const ratio = missing / total;
  if (ratio >= WIDESPREAD_RATIO) {
    return ['widespread',
      `${missing} of ${total} customers (${(ratio * 100).toFixed(0)}%) have no ` +
      'email. That is the signup path behaving this way now, not an old backlog.'];
  }
  if (missing) {
    return ['gaps',
      `${missing} of ${total} customers have no email and will receive no receipt`];
  }
  if (receiptlessCharges) {
    return ['receiptless',
      `every customer has an email, but ${receiptlessCharges} charge(s) had neither ` +
      'a customer nor a receipt_email: guest checkout sends no receipt'];
  }
  return ['clear', 'every customer in the window has an email'];
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

  let total = 0;
  let missing = 0;
  let withActiveSub = 0;
  const emailless = new Set();
  const sample = [];
  for (const cust of await pageAll(key, '/customers', 2000)) {
    total += 1;
    // Both null and '' occur; a form that posts a blank field produces the
    // second, and a check for null alone walks straight past it.
    if ((cust.email ?? '').trim()) continue;
    missing += 1;
    emailless.add(cust.id);
    if (sample.length < 5) sample.push(cust.id);
    const subs = await get(key, '/subscriptions', { customer: cust.id, status: 'active', limit: 1 });
    if ((subs.data ?? []).length) withActiveSub += 1;
  }

  let receiptless = 0;
  let disputed = 0;
  for (const ch of await pageAll(key, '/charges', 2000)) {
    if (!ch.customer && !ch.receipt_email) receiptless += 1;
    if (ch.disputed && emailless.has(ch.customer)) disputed += 1;
  }

  const [state, detail] = verdict(missing, total, withActiveSub, receiptless, disputed);
  const line = `${state.padEnd(11)} ${detail}`;
  if (state === 'clear') { console.log(line); return; }

  console.warn(line);
  for (const cid of sample) console.warn(`  no email  ${cid}`);
  console.warn('  backfill from your own user table:');
  console.warn(`  POST ${API}/customers/{id} -d email=user@example.com -d name="Jenny Rosen"`);
  if (receiptless) {
    console.warn('  and for guest payments, set the address on the intent:');
    console.warn(`  POST ${API}/payment_intents -d receipt_email=user@example.com`);
  }
  console.warn('  then confirm receipts are enabled at https://dashboard.stripe.com/settings/emails');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
