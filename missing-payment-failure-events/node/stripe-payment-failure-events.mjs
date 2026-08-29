/**
 * Report whether anything subscribes to Stripe payment and invoice failure events.
 *
 * Read only. Three GETs, no writes: give this a RESTRICTED key with read access
 * to Webhook Endpoints, Subscriptions and Events. The repair is printed, never
 * performed.
 */
const API = 'https://api.stripe.com/v1';

const PI_OK = 'payment_intent.succeeded';
const PI_FAIL = 'payment_intent.payment_failed';
const INV_FAIL = 'invoice.payment_failed';

/**
 * Classify payment-failure coverage across both surfaces. Pure and testable.
 * The billing surface only counts when the account actually has recurring
 * billing, and failures already seen turn a gap into an incident.
 */
export function verdict(subscribed, hasActiveSubscriptions, failedInvoices) {
  const events = new Set(subscribed ?? []);
  if (events.has('*')) {
    return ['wildcard',
      'a wildcard covers both failure events, and every other type along with them.'];
  }

  const oneOffGap = events.has(PI_OK) && !events.has(PI_FAIL);
  const billingGap = Boolean(hasActiveSubscriptions) && !events.has(INV_FAIL);

  if (billingGap && failedInvoices) {
    return ['blind',
      `${failedInvoices} invoice payment(s) already failed and ${INV_FAIL} is ` +
      'not subscribed. Dunning is running right now and nothing is being told.'];
  }
  if (oneOffGap && billingGap) {
    return ['exposed',
      `neither ${PI_FAIL} nor ${INV_FAIL} is subscribed. Both the one-off and ` +
      'the billing failure paths are silent.'];
  }
  if (oneOffGap) {
    return ['one-sided',
      `${PI_OK} is subscribed and ${PI_FAIL} is not: the success path is wired ` +
      'and declines go nowhere.'];
  }
  if (billingGap) {
    return ['billing-gap',
      `the account has active subscriptions and ${INV_FAIL} is not subscribed. ` +
      'Renewal declines and exhausted retries are invisible.'];
  }
  if (events.has(PI_FAIL) || events.has(INV_FAIL)) {
    return ['covered', 'both applicable failure events are subscribed'];
  }
  return ['no-payment-events',
    'nothing subscribes to payment success or failure at all. The gap here is ' +
    'the endpoint configuration rather than one event type.'];
}

async function get(key, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
    else url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export async function subscribedUnion(key) {
  const union = new Set();
  const { data = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  for (const ep of data) for (const t of ep.enabled_events ?? []) union.add(t);
  return union;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const union = await subscribedUnion(key);
  const { data: active = [] } = await get(key, '/subscriptions',
    { limit: 1, status: 'active' });
  const { data: failures = [] } = await get(key, '/events',
    { limit: 100, 'types[]': [INV_FAIL] });

  const [state, detail] = verdict(union, active.length > 0, failures.length);
  const line = `${state.padEnd(17)} ${detail}`;
  if (state === 'covered' || state === 'wildcard') {
    console.log(line);
    return;
  }

  console.warn(line);
  console.warn(`  repair: add enabled_events[]=${PI_FAIL} and ` +
               `enabled_events[]=${INV_FAIL} to an existing endpoint at ` +
               `${API}/webhook_endpoints/{id}`);
  console.warn('  add invoice.payment_action_required as well if renewals use 3D Secure');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
