/**
 * Report Stripe invoice items left pending with no invoice coming to collect them.
 *
 * Read only. Two GETs, no writes: give this a RESTRICTED key with read access to
 * Invoices and Subscriptions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const FRESH_DAYS = 1;  // created today; a manual invoice may be seconds behind
export const SWEEP_DAYS = 35; // a monthly cycle plus slack: one invoice should have run
export const STALE_DAYS = 60; // two cycles missed, or an annual plan worth confirming

/**
 * Classify one customer's pending invoice items. Pure, so it can be tested.
 * Returns [state, detail].
 */
export function verdict(ageDays, hasActiveSubscription, itemCount) {
  const stack = `${itemCount} pending item(s), oldest ${Math.round(ageDays)}d`;
  if (!hasActiveSubscription) {
    if (ageDays < FRESH_DAYS) {
      return ['fresh',
        `${stack}, no active subscription. Probably an invoice being built right ` +
        'now; check again tomorrow.'];
    }
    return ['orphaned',
      `${stack}, and no active subscription to raise an invoice. Nothing will ever ` +
      'sweep these up.'];
  }
  if (ageDays < SWEEP_DAYS) return ['waiting', `${stack}, next invoice still due`];
  if (ageDays < STALE_DAYS) {
    return ['aging',
      `${stack}, past a monthly cycle. Fine on an annual plan, a miss on a monthly one.`];
  }
  return ['stalled',
    `${stack}, past two monthly cycles with a live subscription. Confirm the ` +
    'billing interval before assuming this is benign.'];
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

async function* paginate(key, path, params = {}) {
  const p = { limit: 100, ...params };
  for (;;) {
    const page = await get(key, path, p);
    const data = page.data ?? [];
    for (const row of data) yield row;
    if (data.length === 0 || !page.has_more) return;
    p.starting_after = data[data.length - 1].id;
  }
}

/**
 * Group pending items per customer, keeping the oldest date and the totals.
 * Amounts stay per currency: summing across currencies is wrong invisibly.
 */
export function bucketByCustomer(items) {
  const buckets = new Map();
  for (const it of items) {
    if (!it.customer) continue;
    if (!buckets.has(it.customer)) {
      buckets.set(it.customer, { count: 0, oldest: null, amounts: {} });
    }
    const b = buckets.get(it.customer);
    b.count += 1;
    const date = it.date ?? it.created;
    if (date !== undefined && date !== null && (b.oldest === null || date < b.oldest)) {
      b.oldest = date;
    }
    const cur = (it.currency ?? '???').toUpperCase();
    b.amounts[cur] = (b.amounts[cur] ?? 0) + (it.amount ?? 0);
  }
  return buckets;
}

async function hasActiveSubscription(key, customer) {
  const page = await get(key, '/subscriptions',
    { customer, status: 'active', limit: 1 });
  return (page.data ?? []).length > 0;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const maxItems = 5000;
  const items = [];
  for await (const it of paginate(key, '/invoiceitems', { pending: 'true' })) {
    items.push(it);
    if (items.length >= maxItems) break;
  }

  const buckets = bucketByCustomer(items);
  const now = Date.now() / 1000;
  let findings = 0;
  const exposure = {};

  const ordered = [...buckets.entries()].sort((a, b) => (a[1].oldest ?? 0) - (b[1].oldest ?? 0));
  for (const [cus, b] of ordered) {
    const age = b.oldest === null ? 0 : (now - b.oldest) / 86400;
    const live = await hasActiveSubscription(key, cus);
    const [state, detail] = verdict(age, live, b.count);
    const money = Object.entries(b.amounts).sort()
      .map(([c, v]) => `${c} ${v}`).join(', ');

    const line = `${state.padEnd(11)} ${cus}  ${detail}  [${money} minor unit(s)]`;
    if (state === 'waiting' || state === 'fresh') { console.log(line); continue; }

    findings += 1;
    for (const [c, v] of Object.entries(b.amounts)) exposure[c] = (exposure[c] ?? 0) + v;
    console.warn(line);
    if (state === 'orphaned') {
      console.warn('  raise one invoice for this customer to sweep every pending ' +
        'item onto it, then finalize it; or delete the items that are no longer ' +
        'owed while they are unattached');
    } else {
      console.warn(`  confirm the billing interval: GET ${API}/subscriptions` +
        `?customer=${cus}&status=active`);
    }
  }

  console.log(`${buckets.size} customer(s) with pending items, ${findings} needing a decision`);
  for (const [c, v] of Object.entries(exposure).sort()) {
    console.log(`  unbilled exposure: ${c} ${v} minor unit(s)`);
  }
  if (findings) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
