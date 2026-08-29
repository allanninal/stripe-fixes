/**
 * Report Stripe subscriptions with no payment method in any of the four slots.
 *
 * Read only. GET requests only, no writes: give this a RESTRICTED key with read
 * access to Subscriptions and Customers. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Walk Stripe's payment-method resolution order for one subscription.
 * Pure, so the order can be tested against the documented one without a network.
 */
export function verdict(sub) {
  if (sub.default_payment_method) {
    return ['subscription', 'charges subscription.default_payment_method'];
  }
  if (sub.default_source) {
    return ['subscription', 'charges subscription.default_source, a legacy source object'];
  }
  const customer = sub.customer;
  if (customer === null || typeof customer !== 'object') {
    return ['unknown',
      'customer was not expanded, so the two customer-level defaults cannot be ' +
      'read; re-run with expand[]=data.customer'];
  }
  const settings = customer.invoice_settings ?? {};
  if (settings.default_payment_method) {
    return ['customer', 'falls back to customer.invoice_settings.default_payment_method'];
  }
  if (customer.default_source) {
    return ['customer', 'falls back to customer.default_source, a legacy source object'];
  }
  return ['unchargeable',
    'all four resolution slots are null, so the renewal invoice cannot be paid ' +
    'and Stripe schedules no retry'];
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

async function pageSubscriptions(key, status, limit) {
  const out = [];
  const q = { status, limit: 100, 'expand[]': 'data.customer' };
  for (;;) {
    const page = await get(key, '/subscriptions', q);
    out.push(...(page.data ?? []));
    if (!page.has_more || out.length >= limit) break;
    q.starting_after = page.data[page.data.length - 1].id;
  }
  return out.slice(0, limit);
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  let checked = 0;
  const counts = new Map();
  for (const status of ['active', 'trialing']) {
    for (const sub of await pageSubscriptions(key, status, 1000)) {
      checked += 1;
      const [state, detail] = verdict(sub);
      counts.set(state, (counts.get(state) ?? 0) + 1);
      if (state === 'subscription') continue;
      const line = `${state.padEnd(13)} ${sub.id ?? '?'} (${status})  ${detail}`;
      if (state === 'customer') { console.log(line); continue; }
      console.warn(line);
      const cus = typeof sub.customer === 'object' && sub.customer !== null
        ? sub.customer.id : sub.customer;
      console.warn(`  repair: collect a card with a SetupIntent or the billing portal, ` +
        `then POST ${API}/customers/${cus ?? 'cus_...'} ` +
        `-d invoice_settings[default_payment_method]=pm_...`);
      console.warn(`  and pin it to the subscription too: ` +
        `POST ${API}/subscriptions/${sub.id} -d default_payment_method=pm_...`);
    }
  }

  console.log(`${checked} subscription(s) checked, ` +
    `${counts.get('unchargeable') ?? 0} unchargeable, ` +
    `${counts.get('customer') ?? 0} relying on a customer-level default`);
  if (counts.get('unknown')) {
    console.warn(`${counts.get('unknown')} row(s) could not be classified: re-run ` +
      'with the customer expanded');
  }
  process.exitCode = (counts.get('unchargeable') ?? 0) + (counts.get('unknown') ?? 0)
    ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
