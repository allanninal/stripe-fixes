/**
 * Report the share of Stripe Checkout Sessions that expire unpaid.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Checkout Sessions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const HIGH_SHARE = 0.5;   // more than half of everything created is discarded
export const WATCH_SHARE = 0.25; // worth looking at before it becomes the first number

/**
 * Classify one window of Checkout Sessions. Pure, so the thresholds are testable.
 * `lapsedOpen` counts sessions still marked open whose expires_at has passed.
 */
export function verdict(total, expired, lapsedOpen = 0) {
  if (!total) return ['no-data', 'no Checkout Sessions were created in the window'];
  const share = expired / total;
  const pct = (100 * share).toFixed(1);
  if (share >= HIGH_SHARE) {
    return ['abandoned',
      `${expired} of ${total} session(s) expired unpaid (${pct}%). More than half ` +
      'of everything created is being discarded.'];
  }
  if (lapsedOpen) {
    return ['lapsed',
      `${lapsedOpen} open session(s) are already past expires_at and have not been ` +
      `marked yet; ${pct}% expired so far.`];
  }
  if (share >= WATCH_SHARE) {
    return ['elevated',
      `${expired} of ${total} session(s) expired unpaid (${pct}%). Shorten the ` +
      'window so the lapse is visible in hours.'];
  }
  return ['normal', `${expired} of ${total} session(s) expired unpaid (${pct}%).`];
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

export async function scan(key, since, cap = 5000) {
  const counts = { open: 0, complete: 0, expired: 0 };
  let total = 0;
  let lapsed = 0;
  const now = Math.floor(Date.now() / 1000);
  const params = { 'created[gte]': since, limit: 100 };
  for (;;) {
    const page = await get(key, '/checkout/sessions', params);
    const data = page.data ?? [];
    for (const cs of data) {
      total += 1;
      const state = cs.status ?? 'unknown';
      counts[state] = (counts[state] ?? 0) + 1;
      if (state === 'open' && cs.expires_at != null && cs.expires_at < now) lapsed += 1;
    }
    if (data.length === 0 || !page.has_more || total >= cap) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { total, counts, lapsed };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number(process.argv[2] ?? 30);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const { total, counts, lapsed } = await scan(key, since);
  const [state, detail] = verdict(total, counts.expired ?? 0, lapsed);

  console.log(`${state.padEnd(11)} ${detail}`);
  console.log(`  open ${counts.open ?? 0}  complete ${counts.complete ?? 0}  ` +
              `expired ${counts.expired ?? 0}  (last ${days} days)`);
  if (state === 'normal' || state === 'no-data') return;

  console.warn('  repair: create sessions with a shorter window so a lapse shows ' +
               'up in hours rather than a day:');
  console.warn(`  POST ${API}/checkout/sessions -d expires_at=<now+7200>   ` +
               '(min 30 minutes, max 24 hours)');
  console.warn('  and subscribe an event destination to checkout.session.expired ' +
               'so each lapse is recorded');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
