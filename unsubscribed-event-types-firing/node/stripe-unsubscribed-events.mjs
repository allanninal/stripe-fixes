/**
 * Report Stripe event types that fire but reach no webhook endpoint.
 *
 * Read only. Two GETs, no writes: give this a RESTRICTED key with read access to
 * Webhook Endpoints and Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one fired event type against the subscription union. Pure, so the
 * rules can be tested without a network.
 */
export function classify(eventType, count, subscribed) {
  const events = new Set(subscribed ?? []);
  if (count <= 0) return ['unseen', `${eventType} did not fire in the retained window`];
  if (events.has('*')) {
    return ['wildcard',
      `${eventType} is delivered by a wildcard subscription, along with every ` +
      'other type the account generates.'];
  }
  if (events.has(eventType)) {
    return ['covered', `${eventType} is subscribed on at least one endpoint`];
  }

  const namespace = eventType.split('.')[0];
  const siblings = [...events].filter((e) => e.split('.')[0] === namespace).sort();
  if (siblings.length > 0) {
    return ['near-miss',
      `${eventType} fired ${count} time(s) and is not subscribed, though ` +
      `${siblings[0]} is. enabled_events matches type names exactly: only the ` +
      'literal * is a wildcard, so a namespace is never covered by a sibling.'];
  }
  return ['missed',
    `${eventType} fired ${count} time(s) and reached no endpoint. Nothing in ` +
    `the ${namespace} namespace is subscribed anywhere on this account.`];
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

export async function subscribedUnion(key) {
  const union = new Set();
  const { data = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  for (const ep of data) for (const t of ep.enabled_events ?? []) union.add(t);
  return union;
}

export async function firedCounts(key, limit = 2000) {
  const counts = new Map();
  let total = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/events', params);
    const data = page.data ?? [];
    for (const ev of data) {
      total += 1;
      counts.set(ev.type, (counts.get(ev.type) ?? 0) + 1);
    }
    if (data.length === 0 || !page.has_more || total >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return counts;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const union = await subscribedUnion(key);
  if (union.size === 0) {
    console.warn('no endpoint subscribes to anything in this mode: ' +
                 'every event below is undelivered');
  }

  const counts = await firedCounts(key);
  const sampled = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`sampled ${sampled} event(s) across ${counts.size} distinct type(s), ` +
              `${union.size} subscribed type(s)`);

  let gaps = 0;
  for (const [eventType, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const [state, detail] = classify(eventType, count, union);
    if (state === 'covered' || state === 'wildcard' || state === 'unseen') continue;
    gaps += 1;
    console.warn(`${state.padEnd(9)} ${detail}`);
  }

  if (gaps > 0) {
    console.warn('repair: add the types your handler branches on to an existing ' +
                 `endpoint's enabled_events[] at ${API}/webhook_endpoints/{id}. ` +
                 'Adding * instead trades this for a flooded handler');
  }
  console.log(`${counts.size} type(s) fired, ${gaps} unsubscribed`);
  process.exitCode = gaps ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
