/**
 * Report Stripe subscriptions that will have nothing to charge at renewal.
 *
 * Read only. One paginated GET per status, no writes: give this a RESTRICTED key
 * with read access to Subscriptions and Customers. The repair is printed, never
 * performed.
 */
const API = 'https://api.stripe.com/v1';

export const FAILED_STATUSES = ['past_due', 'unpaid'];

/**
 * Classify one subscription. Pure, so the rules can be tested without a network.
 *
 * The subscription's `customer` must be expanded; when it is only an id there is
 * no way to know whether a customer-level default exists, and guessing either way
 * is worse than saying so.
 */
export function verdict(subscription) {
  const settings = subscription.payment_settings ?? {};
  const save = settings.save_default_payment_method;

  // Absent is the same as 'off': Stripe omits the field when it was never set,
  // which is how almost every affected subscription actually looks.
  if (save !== undefined && save !== null && save !== 'off' && save !== 'on_subscription') {
    return ['unknown', `unrecognised save_default_payment_method ${JSON.stringify(save)}`];
  }
  if (save === 'on_subscription') {
    return ['on', 'the card that pays an invoice becomes the subscription default'];
  }

  if (subscription.default_payment_method) {
    return ['saved', 'the flag is off, but a default is already set on the subscription'];
  }

  const customer = subscription.customer;
  if (!customer || typeof customer !== 'object') {
    return ['unknown',
      'customer is not expanded, so the fallback default cannot be read; ' +
      're-read with expand[]=data.customer'];
  }

  if (customer.invoice_settings?.default_payment_method) {
    return ['fallback',
      'nothing on the subscription; renewals fall back to the customer default. ' +
      'Working, and one refactor away from not working.'];
  }

  if (FAILED_STATUSES.includes(subscription.status)) {
    return ['failing',
      `status ${subscription.status} with no payment method on the subscription ` +
      'and none on the customer. The renewal has already failed.'];
  }

  return ['stranded',
    'no payment method on the subscription and none on the customer. The next ' +
    'renewal has nothing to charge.'];
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

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const counts = new Map();
  const flagged = [];
  let total = 0;
  for (const status of ['active', ...FAILED_STATUSES]) {
    for await (const sub of pageAll(key, '/subscriptions', 5000,
      { status, 'expand[]': 'data.customer' })) {
      total += 1;
      const [state, detail] = verdict(sub);
      counts.set(state, (counts.get(state) ?? 0) + 1);
      if (state === 'stranded' || state === 'failing' || state === 'unknown') {
        flagged.push([state, sub.id, detail]);
      }
    }
  }

  if (!total) {
    console.log("no subscriptions for this key's mode");
    return;
  }

  for (const [state, id, detail] of flagged.slice(0, 25)) {
    console.warn(`${state.padEnd(9)} ${id}  ${detail}`);
    console.warn(`  repair: POST ${API}/subscriptions/${id} ` +
                 '-d "payment_settings[save_default_payment_method]=on_subscription"');
  }

  const stranded = counts.get('stranded') ?? 0;
  const failing = counts.get('failing') ?? 0;
  if (counts.get('fallback')) {
    console.log(`${counts.get('fallback')} subscription(s) rely on the customer ` +
                'default; they work until the signup flow stops writing it');
  }
  console.log(`${total} subscription(s), ${stranded} stranded, ${failing} already failing`);
  if (!(stranded + failing)) return;
  console.warn('set it at creation so this stops recurring:');
  console.warn(`  POST ${API}/subscriptions ` +
               '-d "payment_settings[save_default_payment_method]=on_subscription"');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
