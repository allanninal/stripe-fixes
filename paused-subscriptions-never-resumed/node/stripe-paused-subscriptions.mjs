/**
 * Report paused subscriptions, sorted by whether they can still be resumed.
 *
 * Read only. One GET, no writes: give this a RESTRICTED key with read access to
 * Subscriptions and Customers. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const DAY = 86400;
const INTERVALS = { day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };

/**
 * Length of one billing interval, from the first item's recurring price.
 * Falls back to 30 days when the price is not expanded.
 */
export function intervalSeconds(sub) {
  const items = sub.items?.data ?? [];
  if (items.length === 0) return 30 * DAY;
  const price = items[0].price ?? items[0].plan ?? {};
  const recurring = price.recurring ?? price;
  const unit = INTERVALS[recurring.interval];
  if (!unit) return 30 * DAY;
  return unit * (recurring.interval_count ?? 1);
}

/** True when Stripe has something to charge the moment this is resumed. */
export function hasPaymentMethod(sub) {
  const customer = typeof sub.customer === 'object' && sub.customer !== null
    ? sub.customer : {};
  return Boolean(sub.default_payment_method
    || sub.default_source
    || customer.invoice_settings?.default_payment_method
    || customer.default_source);
}

/** Classify one paused subscription. Pure, so the rules can be tested. */
export function verdict(sub, now) {
  if (sub.status !== 'paused') {
    return ['not-paused',
      `status is ${JSON.stringify(sub.status)}; paused is only reachable from a ` +
      'trial that ended with no payment method'];
  }
  if (hasPaymentMethod(sub)) {
    return ['resumable',
      'a payment method is already on file. The only thing keeping this paused ' +
      'is the resume nobody performed.'];
  }
  const since = sub.trial_end ?? sub.start_date ?? now;
  const age = now - since;
  const days = Math.floor(age / DAY);
  if (age > intervalSeconds(sub)) {
    return ['stale',
      `paused ${days} day(s), longer than one billing interval. This is churn ` +
      'that was never recorded as churn.'];
  }
  return ['recent',
    `paused ${days} day(s), inside one billing interval. The win-back window is ` +
    'still open.'];
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

export async function pausedSubscriptions(key, limit = 1000) {
  const out = [];
  const params = { status: 'paused', limit: 100, 'expand[]': 'data.customer' };
  for (;;) {
    const page = await get(key, '/subscriptions', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const subs = await pausedSubscriptions(key);
  const now = Math.floor(Date.now() / 1000);
  const counts = new Map();
  for (const sub of subs) {
    const [state, detail] = verdict(sub, now);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    console.warn(`${state.padEnd(10)} ${sub.id}  ${detail}`);
    if (state === 'resumable') {
      console.warn(`  repair: POST ${API}/subscriptions/${sub.id} ` +
                   '-d pause_collection= -d default_payment_method={pm}');
    } else if (state === 'stale') {
      console.warn('  repair: count it as churn, or send a billing portal link ' +
                   'before you do');
    }
  }

  console.log(`${subs.length} paused subscription(s): ` +
              `${counts.get('resumable') ?? 0} resumable, ` +
              `${counts.get('stale') ?? 0} stale`);
  if (subs.length > 0) {
    console.log('handle customer.subscription.paused so this list has an owner');
  }
  process.exitCode = subs.length > 0 ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
