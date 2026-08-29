/**
 * Report active subscriptions already scheduled to cancel, as a rate and a date.
 *
 * Read only. One GET, no writes: give this a RESTRICTED key with read access to
 * Subscriptions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const DAY = 86400;

const ELEVATED_RATE = 0.10;  // scheduled / active above this is a trend
const CLIFF_DAYS = 7;        // a cancellation this close needs an answer this week

/**
 * When service actually ends, or null if it is not scheduled to.
 * Deliberately not `canceled_at`: that is populated when the flag is set.
 */
export function scheduledEnd(sub) {
  if (sub.cancel_at) return sub.cancel_at;
  if (!sub.cancel_at_period_end) return null;
  const items = sub.items?.data ?? [];
  if (items.length > 0 && items[0].current_period_end) {
    return items[0].current_period_end;
  }
  return sub.current_period_end ?? null;
}

/** Classify a pending-churn backlog. Pure, so the rules can be tested. */
export function verdict(scheduled, activeTotal, soonestDays) {
  if (!activeTotal) return ['empty', 'no active subscriptions in this account and mode'];
  if (!scheduled) {
    return ['clear', `${activeTotal} active subscription(s), none scheduled to cancel`];
  }

  const rate = scheduled / activeTotal;
  const summary = `${scheduled} of ${activeTotal} active subscription(s) ` +
    `(${(rate * 100).toFixed(1)}%) are scheduled to cancel`;

  if (soonestDays !== null && soonestDays !== undefined && soonestDays <= CLIFF_DAYS) {
    return ['imminent', `${summary}, the first in ${soonestDays} day(s)`];
  }
  if (rate >= ELEVATED_RATE) {
    return ['elevated',
      `${summary}. Above ${Math.round(ELEVATED_RATE * 100)}% this is a trend ` +
      'with a cause, not attrition.'];
  }
  return ['backlog', summary];
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

export async function activeSubscriptions(key, limit = 5000) {
  const out = [];
  const params = { status: 'active', limit: 100 };
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

  const subs = await activeSubscriptions(key);
  const now = Math.floor(Date.now() / 1000);

  const ends = [];
  const reasons = new Map();
  for (const sub of subs) {
    const end = scheduledEnd(sub);
    if (end === null) continue;
    ends.push(end);
    const why = sub.cancellation_details?.feedback ?? 'not captured';
    reasons.set(why, (reasons.get(why) ?? 0) + 1);
  }

  const soonest = ends.length > 0
    ? Math.floor((Math.min(...ends) - now) / DAY) : null;
  const [state, detail] = verdict(ends.length, subs.length, soonest);

  if (state === 'clear' || state === 'empty') {
    console.log(`${state.padEnd(9)} ${detail}`);
    return;
  }

  console.warn(`${state.padEnd(9)} ${detail}`);
  const listed = [...reasons.entries()].sort().map(([k, v]) => `${k} x${v}`).join(', ');
  console.warn(`  reasons: ${listed}`);
  if (reasons.get('not captured')) {
    console.warn('  repair: enable subscription_cancel.cancellation_reason on the ' +
                 'billing portal configuration so reasons are recorded');
  }
  console.warn(`  repair: per salvageable subscription, POST ${API}/subscriptions/{sub} ` +
               '-d cancel_at_period_end=false');
  console.warn('  repair: trigger the save offer from customer.subscription.updated ' +
               'on the day the flag flips');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
