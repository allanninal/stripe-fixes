/**
 * Report Stripe PaymentIntents that were created and never confirmed.
 *
 * Read only. One paginated GET, no writes: give this a RESTRICTED key with read
 * access to PaymentIntents. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const STALE_SECONDS = 7 * 86400;
const OPEN_STATUSES = ['requires_payment_method', 'requires_confirmation'];

/**
 * Classify one PaymentIntent. Pure, so the rules can be tested without a network.
 * The split that matters is last_payment_error: null means nothing was ever
 * attempted, populated means the customer tried and was declined. The two look
 * identical in a status count and need opposite fixes.
 */
export function classify(intent, now, staleAfter = STALE_SECONDS) {
  const status = intent.status;
  if (!OPEN_STATUSES.includes(status)) {
    return ['other', `status ${JSON.stringify(status)}, not an open intent`];
  }
  const created = intent.created;
  if (!Number.isInteger(created)) {
    return ['unknown', 'no created timestamp, so the intent cannot be aged'];
  }
  const days = Math.floor((now - created) / 86400);
  if (now - created < staleAfter) {
    return ['recent', `${status}, ${days}d old, still plausibly live`];
  }
  if (status === 'requires_confirmation') {
    return ['unconfirmed',
      `${days}d old: confirmation_method is manual and the server never called confirm`];
  }
  const err = intent.last_payment_error;
  if (err) {
    const reason = err.decline_code ?? err.code ?? 'no code given';
    return ['declined',
      `${days}d old: last attempt was declined (${reason}) and nothing offered a retry`];
  }
  return ['never-attempted',
    `${days}d old: created but no payment method was ever attached`];
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

export async function* paymentIntents(key, since, until, cap) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since, 'created[lt]': until };
  for (;;) {
    const page = await get(key, '/payment_intents', params);
    const data = page.data ?? [];
    for (const pi of data) {
      yield pi;
      seen += 1;
      if (seen >= cap) return;
    }
    if (!page.has_more || data.length === 0) return;
    params.starting_after = data[data.length - 1].id;
  }
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number((process.env.DAYS || "dummy-days") ?? 30);
  const staleDays = Number((process.env.STALE_DAYS || "dummy-stale-days") ?? 7);
  const staleAfter = staleDays * 86400;
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;
  const until = now - staleAfter; // only intents old enough to have a verdict

  const counts = new Map();
  const codes = new Map();
  const examples = [];
  let scanned = 0;

  for await (const pi of paymentIntents(key, since, until, 5000)) {
    scanned += 1;
    const [state, detail] = classify(pi, now, staleAfter);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'declined') {
      const err = pi.last_payment_error ?? {};
      const code = err.decline_code ?? err.code ?? 'unknown';
      codes.set(code, (codes.get(code) ?? 0) + 1);
    }
    if (['never-attempted', 'declined', 'unconfirmed'].includes(state) && examples.length < 10) {
      examples.push([pi.id, detail]);
    }
  }

  const never = counts.get('never-attempted') ?? 0;
  const declined = counts.get('declined') ?? 0;
  const unconfirmed = counts.get('unconfirmed') ?? 0;
  const stale = never + declined + unconfirmed;

  for (const [id, detail] of examples) console.warn(`${id}  ${detail}`);

  const share = scanned ? Math.round((100 * stale) / scanned) : 0;
  console.log(`${scanned} intent(s) older than ${staleDays}d: ${stale} stale (${share}%) - ` +
              `${never} never-attempted, ${declined} declined, ${unconfirmed} unconfirmed`);

  for (const [code, n] of [...codes].sort((a, b) => b[1] - a[1])) {
    console.warn(`  decline ${code.padEnd(28)} ${n}`);
  }

  if (share > 30) console.warn('  over 30% of intents in this window never went anywhere');
  if (never) {
    console.warn('  repair: create the PaymentIntent when the customer submits, ' +
                 'not when the payment page renders');
  }
  if (declined) {
    console.warn('  repair: retry on the same intent and show ' +
                 'last_payment_error.message rather than a generic failure');
  }
  if (unconfirmed) {
    console.warn(`  repair: find the job that owes Stripe POST ${API}` +
                 '/payment_intents/{id}/confirm and fix it');
  }
  if (stale) {
    console.warn(`  to clear the backlog: POST ${API}/payment_intents/{id}/cancel ` +
                 '-d cancellation_reason=abandoned');
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
