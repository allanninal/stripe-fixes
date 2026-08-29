/**
 * Measure Stripe incomplete_expired subscriptions against activations.
 *
 * Read only. Two paginated GETs, no writes: give this a RESTRICTED key with read
 * access to Subscriptions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Share of activations above which the confirmation step is failing for part of
// the traffic rather than being abandoned by part of the customers.
export const LEAKING = 0.10;
export const BROKEN = 0.50;

/**
 * Judge one window of signups by the share that never confirmed. Pure.
 *
 * Takes two counts rather than one subscription, because the finding is a ratio:
 * 200 expired is noise against 4,000 activations and an outage against 300.
 */
export function verdict(expired, active, days = 30, leaking = LEAKING, broken = BROKEN) {
  if (expired < 0 || active < 0) {
    return ['unknown', 'negative counts, so the ratio means nothing'];
  }

  if (expired === 0 && active === 0) {
    return ['no-signups',
      `no subscriptions created in the last ${days} day(s), so there is nothing to measure`];
  }

  if (expired === 0) {
    return ['clean',
      `${active} activation(s) in ${days} day(s) and nothing expired unconfirmed`];
  }

  if (active === 0) {
    return ['broken',
      `${expired} subscription(s) expired unconfirmed and not one activated in ` +
      `${days} day(s): nothing is confirming at all`];
  }

  const ratio = expired / active;
  const pct = (100 * ratio).toFixed(1);

  if (ratio >= broken) {
    return ['broken',
      `${expired} expired against ${active} activation(s), ${pct}%: the ` +
      'confirmation step is failing for most of the traffic'];
  }

  if (ratio >= leaking) {
    return ['leaking',
      `${expired} expired against ${active} activation(s), ${pct}%: a slice of ` +
      'the traffic cannot complete the confirmation'];
  }

  return ['background',
    `${expired} expired against ${active} activation(s), ${pct}%: ordinary abandonment`];
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

// Page a status to the end. One page of each and a division is a wrong answer.
async function count(key, status, since, limit) {
  let total = 0;
  const params = { status, limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/subscriptions', params);
    const rows = page.data ?? [];
    total += rows.length;
    if (!page.has_more || rows.length === 0 || total >= limit) break;
    params.starting_after = rows[rows.length - 1].id;
  }
  return total;
}

async function main() {
  const days = Number(process.argv[2] ?? 30);

  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const expired = await count(key, 'incomplete_expired', since, 5000);
  const active = await count(key, 'active', since, 5000);

  const [state, detail] = verdict(expired, active, days);
  if (state === 'clean' || state === 'background' || state === 'no-signups') {
    console.log(`${state}: ${detail}`);
    return;
  }

  console.warn(`${state}: ${detail}`);
  console.warn('repair: create with payment_behavior=default_incomplete, expand ' +
    'latest_invoice.confirmation_secret, and confirm it client side in the same session');
  console.warn('repair: handle invoice.payment_action_required so an unfinished ' +
    'signup gets an email rather than a countdown');
  console.warn('note: expired subscriptions are terminal. The invoice is void and ' +
    'no API call revives them; these customers need a new signup.');
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
