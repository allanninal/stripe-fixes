/**
 * Report Stripe API requests made without an Idempotency-Key.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// A duplicate of any of these costs real money or real support time.
export const MONEY_MOVING = ['payment_intent.created', 'charge.succeeded',
                             'refund.created'];
const WATCHED = [...MONEY_MOVING, 'customer.created'];

/**
 * What one event's `request` field says about the call that caused it. Pure.
 * Returns 'stripe', 'unreported', 'keyed' or 'unkeyed'.
 */
export function classify(request) {
  if (request === null || request === undefined) return 'stripe';
  if (typeof request === 'string') return request ? 'unreported' : 'stripe';
  if (!request.id) return 'stripe';
  return request.idempotency_key ? 'keyed' : 'unkeyed';
}

/** Classify one event type's tally. Pure, so the thresholds can be tested. */
export function verdict(eventType, apiRequests, unkeyed) {
  if (!apiRequests) {
    return ['stripe-only',
      'no API-originated events in the window: nothing here is yours to key'];
  }
  if (!unkeyed) return ['keyed', `${apiRequests} API request(s), all carrying a key`];
  const pct = ((100 * unkeyed) / apiRequests).toFixed(1);
  if (MONEY_MOVING.includes(eventType)) {
    return ['exposed',
      `${unkeyed} of ${apiRequests} API request(s) sent no key (${pct}%). ` +
      'A retried timeout on any of these charges the customer twice.'];
  }
  return ['unkeyed',
    `${unkeyed} of ${apiRequests} API request(s) sent no key (${pct}%). ` +
    'Retries create duplicate records rather than duplicate charges.'];
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

export async function tally(key, since, limit = 5000) {
  const counts = new Map(WATCHED.map((t) => [t, { api: 0, unkeyed: 0, unreported: 0 }]));
  let total = 0;
  const params = { limit: 100, 'created[gte]': Math.floor(since) };
  WATCHED.forEach((t, i) => { params[`types[${i}]`] = t; });
  for (;;) {
    const page = await get(key, '/events', params);
    const data = page.data ?? [];
    for (const ev of data) {
      total += 1;
      const row = counts.get(ev.type);
      if (!row) continue;
      const state = classify(ev.request);
      if (state === 'stripe') continue;
      if (state === 'unreported') { row.unreported += 1; continue; }
      row.api += 1;
      if (state === 'unkeyed') row.unkeyed += 1;
    }
    if (data.length === 0 || !page.has_more || total >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { counts, total };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number((process.env.DAYS || "dummy-days") ?? 30);
  const since = Date.now() / 1000 - days * 86400;
  const { counts, total } = await tally(key, since);
  console.log(`sampled ${total} event(s) over ${days} day(s)`);

  let bad = 0;
  for (const t of WATCHED) {
    const row = counts.get(t);
    const [state, detail] = verdict(t, row.api, row.unkeyed);
    const line = `${state.padEnd(11)} ${t.padEnd(24)} ${detail}`;
    if (state === 'keyed' || state === 'stripe-only') {
      console.log(line);
    } else {
      bad += 1;
      console.warn(line);
    }
    if (row.unreported) {
      console.log(`  ${row.unreported} event(s) rendered at an API version that ` +
                  'does not report the key; upgrade the endpoint pin to judge them');
    }
  }

  if (bad) {
    console.warn('  repair: send an Idempotency-Key header on every mutating ' +
                 'request, in the options argument rather than the params:');
    console.warn('  node:   stripe.paymentIntents.create(params, { idempotencyKey })');
    console.warn('  python: stripe.PaymentIntent.create(..., idempotency_key=key)');
    console.warn("  php:    $stripe->paymentIntents->create($params, " +
                 "['idempotency_key' => $key])");
    console.warn('  the key is a v4 uuid per logical operation, persisted with ' +
                 'the order and reused unchanged for every retry of it');
  }
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
