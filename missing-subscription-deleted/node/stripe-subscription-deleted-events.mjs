/**
 * Report whether customer.subscription.deleted is subscribed, and who is over-entitled.
 *
 * Read only. Three GETs, no writes: give this a RESTRICTED key with read access
 * to Webhook Endpoints and Subscriptions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const TARGET = 'customer.subscription.deleted';
const COMPANION = 'customer.subscription.updated';

/**
 * Classify entitlement-revocation coverage. Pure, so the rules can be tested.
 */
export function verdict(subscribed, canceled, active) {
  const events = new Set(subscribed ?? []);
  if (!canceled && !active) {
    return ['not-billing',
      `no subscriptions on this account at all, so ${TARGET} is not a gap worth ` +
      'reporting yet'];
  }
  if (events.has('*')) {
    return ['wildcard',
      `a wildcard subscription covers ${TARGET}, but it also delivers every ` +
      'other event type to the same handler.'];
  }
  if (events.has(TARGET)) {
    if (!events.has(COMPANION)) {
      return ['partial',
        `${TARGET} is subscribed but ${COMPANION} is not. You learn that a ` +
        'subscription ended, never that a cancellation was scheduled.'];
    }
    return ['covered', `${TARGET} is subscribed on at least one endpoint`];
  }
  if (canceled) {
    return ['over-entitled',
      `${canceled} canceled subscription(s) and nothing subscribes to ${TARGET}. ` +
      'Each one is an account your application was never asked to revoke.'];
  }
  return ['unsubscribed',
    `${active} active subscription(s) and nothing subscribes to ${TARGET}. ` +
    'Nothing has ended yet, so this is a gap rather than a backlog.'];
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

/** Union of enabled_events across endpoints. Pure, given the endpoint list. */
export function subscribedEvents(endpoints) {
  const union = new Set();
  for (const ep of endpoints ?? []) {
    for (const t of ep.enabled_events ?? []) union.add(t);
  }
  return union;
}

async function countSubscriptions(key, status, limit = 1000) {
  let count = 0;
  const ids = [];
  const params = { limit: 100, status };
  for (;;) {
    const page = await get(key, '/subscriptions', params);
    const data = page.data ?? [];
    for (const sub of data) {
      count += 1;
      if (ids.length < 10) ids.push(sub.id);
    }
    if (data.length === 0 || !page.has_more || count >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { count, ids };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const { data: endpoints = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  const union = subscribedEvents(endpoints);
  const canceled = await countSubscriptions(key, 'canceled');
  const active = await countSubscriptions(key, 'active');

  const [state, detail] = verdict(union, canceled.count, active.count);
  const line = `${state.padEnd(14)} ${detail}`;
  if (state === 'covered' || state === 'not-billing') {
    console.log(line);
    return;
  }

  console.warn(line);
  if (state === 'over-entitled') {
    for (const sid of canceled.ids) console.warn(`  reconcile: ${sid}`);
  }
  if (state !== 'wildcard') {
    console.warn(`  repair: POST ${API}/webhook_endpoints/${endpoints[0]?.id ?? '<we_id>'}`);
    console.warn(`    -d enabled_events[]=${TARGET}`);
    console.warn(`    -d enabled_events[]=${COMPANION}`);
    console.warn('    (enabled_events is replaced wholesale: send the existing types too)');
  }
  console.warn(`  then sweep GET ${API}/subscriptions?status=canceled against your ` +
               'own entitlement table: subscribing fixes the future only');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
