/**
 * Report Stripe subscriptions stuck in incomplete before the 23-hour deadline.
 *
 * Read only. One GET request, no writes: give this a RESTRICTED key with read
 * access to Subscriptions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Stripe holds an unpaid first invoice open for exactly 23 hours, then moves the
// subscription to the terminal incomplete_expired and voids the invoice.
export const WINDOW = 82800;
// The last stretch before that, where a human can still rescue an individual one.
const LAST_CHANCE = 7200;

/**
 * Classify one incomplete subscription by how long it has sat unconfirmed.
 * Pure, so the 23-hour boundary can be tested without a network.
 */
export function verdict(sub, now, grace = 3600) {
  const created = sub.created;
  if (typeof created !== 'number') {
    return ['unknown', 'no created timestamp, so this row cannot be aged'];
  }
  const age = now - created;
  if (age >= WINDOW) {
    return ['expired',
      `${(age / 3600).toFixed(1)} h old: past the 23 hour window, so the invoice ` +
      'is voided and this record cannot be revived'];
  }
  if (age >= WINDOW - LAST_CHANCE) {
    return ['expiring',
      `${(age / 3600).toFixed(1)} h old: under ${((WINDOW - age) / 3600).toFixed(1)} h ` +
      'left before Stripe expires it'];
  }
  if (age >= grace) {
    return ['stalled',
      `${(age / 3600).toFixed(1)} h old and still unconfirmed: the first ` +
      'PaymentIntent was never confirmed by the client'];
  }
  return ['pending',
    `${(age / 60).toFixed(0)} min old: a customer may still be on the confirmation step`];
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

async function pageAll(key, path, limit, params = {}) {
  const out = [];
  const q = { ...params, limit: 100 };
  for (;;) {
    const page = await get(key, path, q);
    out.push(...(page.data ?? []));
    if (!page.has_more || out.length >= limit) break;
    q.starting_after = page.data[page.data.length - 1].id;
  }
  return out.slice(0, limit);
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const subs = await pageAll(key, '/subscriptions', 1000, { status: 'incomplete' });
  if (subs.length === 0) {
    console.log("no incomplete subscriptions for this key's mode");
    return;
  }

  const now = Date.now() / 1000;
  const counts = new Map();
  for (const sub of subs) {
    const [state, detail] = verdict(sub, now);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    const line = `${state.padEnd(8)} ${sub.id ?? '?'}  ${detail}`;
    if (state === 'pending') { console.log(line); continue; }
    console.warn(line);
    if (state === 'expired') {
      console.warn(`  repair: unrecoverable. Create a new subscription: ` +
        `POST ${API}/subscriptions -d customer=${sub.customer ?? 'cus_...'} ` +
        `-d items[0][price]=... -d default_payment_method=...`);
    } else {
      console.warn(`  repair: confirm the first invoice's PaymentIntent client side ` +
        `before ${API}/subscriptions/${sub.id} expires`);
    }
  }

  const bad = subs.length - (counts.get('pending') ?? 0);
  console.log(`${subs.length} incomplete subscription(s), ` +
    `${counts.get('expired') ?? 0} past the 23 hour window, ` +
    `${counts.get('stalled') ?? 0} stalled`);
  if (bad) {
    console.warn('structural fix: create with payment_behavior=default_incomplete ' +
      "and confirm the invoice's client secret in the same session");
  }
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
