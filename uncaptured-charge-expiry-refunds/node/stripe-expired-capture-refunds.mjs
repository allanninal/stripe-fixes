/**
 * Report Stripe refunds that Stripe wrote itself when an authorization expired.
 *
 * Read only. A paginated GET over Refunds and one lookup per candidate charge,
 * no writes: give this a RESTRICTED key with read access to Refunds and Charges.
 * The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Set by Stripe when an uncaptured authorization runs out of time. The one
// reason value on the Refund object nobody in your business can choose.
export const EXPIRED = 'expired_uncaptured_charge';

const CUSTOMER_REASONS = ['requested_by_customer', 'duplicate', 'fraudulent'];

/**
 * Sort one Refund into money a human gave back and money that fell off a card.
 * Pure. `charge` is the Charge it belongs to, or null when it was not fetched.
 */
export function classify(refund, charge = null) {
  const reason = refund.reason ?? null;

  if (reason === EXPIRED) {
    if (charge === null || charge === undefined) {
      return ['expired-unverified',
        'Stripe wrote this when the authorization expired, but the charge was ' +
        'not fetched, so captured is unconfirmed'];
    }
    if (charge.captured === false) {
      return ['expired',
        'the authorization expired uncaptured: nobody issued this refund and ' +
        'no customer asked for it'];
    }
    return ['inconsistent',
      `reason says the authorization expired but the charge reports ` +
      `captured=${JSON.stringify(charge.captured)}: read the charge before ` +
      'counting this one'];
  }

  if (CUSTOMER_REASONS.includes(reason)) {
    return ['customer', `a real refund (${reason}), belongs in the refund rate`];
  }

  if (reason === null) {
    return ['unlabelled',
      'no reason recorded: issued through the API or the Dashboard without one, ' +
      'so it counts as a real refund until proven otherwise'];
  }

  return ['other', `unrecognised reason ${JSON.stringify(reason)}, left in the rate`];
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

async function* pageRefunds(key, since, limit) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/refunds', params);
    const rows = page.data ?? [];
    for (const refund of rows) { yield refund; seen += 1; }
    if (!page.has_more || rows.length === 0 || seen >= limit) break;
    params.starting_after = rows[rows.length - 1].id;
  }
}

function add(bucket, currency, amount) {
  bucket.set(currency, (bucket.get(currency) ?? 0) + (amount ?? 0));
}

function money(bucket) {
  if (bucket.size === 0) return 'nothing';
  return [...bucket.entries()].sort()
    .map(([k, v]) => `${(v / 100).toFixed(2)} ${k.toUpperCase()}`).join(', ');
}

async function main() {
  const days = Number(process.argv[2] ?? 90);
  const verify = process.argv.includes('--verify-charges');

  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const charges = new Map();
  const states = new Map();
  const allMoney = new Map();
  const expiredMoney = new Map();
  let scanned = 0;

  for await (const refund of pageRefunds(key, since, 2000)) {
    scanned += 1;
    const currency = refund.currency ?? '???';
    add(allMoney, currency, refund.amount);

    let charge = null;
    if (verify && refund.reason === EXPIRED && typeof refund.charge === 'string') {
      if (!charges.has(refund.charge)) {
        charges.set(refund.charge, await get(key, `/charges/${refund.charge}`));
      }
      charge = charges.get(refund.charge);
    }

    const [state, detail] = classify(refund, charge);
    states.set(state, (states.get(state) ?? 0) + 1);

    if (state === 'expired' || state === 'expired-unverified') {
      add(expiredMoney, currency, refund.amount);
      console.warn(`${state.padEnd(18)} ${refund.id ?? '?'}  ${detail}`);
    } else if (state === 'inconsistent') {
      console.warn(`${state.padEnd(18)} ${refund.id ?? '?'}  ${detail}`);
    }
  }

  if (scanned === 0) {
    console.log(`no refunds in the last ${days} day(s)`);
    return;
  }

  const summary = [...states.entries()].sort().map(([k, n]) => `${n} ${k}`).join(', ');
  console.log(`${scanned} refund(s) in ${days} day(s): ${summary}`);
  console.log(`refunded in total: ${money(allMoney)}`);

  if (expiredMoney.size === 0) {
    console.log('nothing refunded because an authorization expired');
    return;
  }

  console.warn(`refunded because an authorization expired: ${money(expiredMoney)}`);
  for (const [currency, amount] of [...expiredMoney.entries()].sort()) {
    const total = allMoney.get(currency) ?? 0;
    if (total) {
      console.warn(`  ${currency.toUpperCase()}: ` +
        `${((100 * amount) / total).toFixed(1)}% of everything refunded in this window`);
    }
  }
  console.warn(`repair: exclude reason=${EXPIRED} from the customer-facing refund ` +
               'rate and report it as an operational number instead');
  console.warn('repair: fix the capture pipeline; the real deadline is ' +
               'capture_before on the charge, not created plus seven days');
  console.warn('repair: subscribe to charge.refund.updated and alert when a ' +
               'refund arrives carrying this reason');
  process.exitCode = 1;
}

// Only run when invoked directly, so importing this module from the test file
// does not fire main(), fail on the missing key, and set a non-zero exit code
// that fails the whole test run even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
