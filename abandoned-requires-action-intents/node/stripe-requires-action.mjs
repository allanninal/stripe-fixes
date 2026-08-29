/**
 * Report Stripe PaymentIntents abandoned at the authentication step.
 *
 * Read only. One paginated GET, no writes: give this a RESTRICTED key with read
 * access to PaymentIntents. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const STALE_SECONDS = 24 * 3600;

/**
 * Classify one PaymentIntent. Pure, so the rules can be tested without a network.
 * `now` is a unix timestamp passed in, so the ageing rule can be tested at a
 * pinned clock rather than only on the day the test was written.
 */
export function classify(intent, now, staleAfter = STALE_SECONDS) {
  const status = intent.status;
  if (status !== 'requires_action') {
    return ['other', `status ${JSON.stringify(status)}, not waiting on authentication`];
  }
  const created = intent.created;
  if (!Number.isInteger(created)) {
    return ['unknown', 'no created timestamp, so the intent cannot be aged'];
  }
  const action = intent.next_action?.type;
  if (!action) {
    return ['no-next-action',
      'requires_action with an empty next_action: the client was never told ' +
      'what to do, so nothing can finish this'];
  }
  const hours = Math.floor((now - created) / 3600);
  if (now - created < staleAfter) {
    return ['in-flight',
      `${action}, ${hours}h old, still inside the window a customer plausibly needs`];
  }
  return ['abandoned',
    `${action}, ${hours}h old: the customer left the authentication step and never came back`];
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

export async function* paymentIntents(key, since, cap) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since };
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
  const staleAfter = Number((process.env.STALE_HOURS || "dummy-stale-hours") ?? 24) * 3600;
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;

  const counts = new Map();
  const byAction = new Map();
  const examples = [];
  let scanned = 0;

  for await (const pi of paymentIntents(key, since, 5000)) {
    scanned += 1;
    const [state, detail] = classify(pi, now, staleAfter);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'abandoned' || state === 'no-next-action') {
      const action = pi.next_action?.type ?? 'none';
      byAction.set(action, (byAction.get(action) ?? 0) + 1);
      if (examples.length < 10) examples.push([pi.id, detail]);
    }
  }

  const abandoned = counts.get('abandoned') ?? 0;
  const inFlight = counts.get('in-flight') ?? 0;
  const headless = counts.get('no-next-action') ?? 0;

  for (const [id, detail] of examples) console.warn(`${id}  ${detail}`);

  console.log(`scanned ${scanned} intent(s): ${abandoned} abandoned, ` +
              `${inFlight} in-flight, ${headless} with no next_action`);

  for (const [action, n] of [...byAction].sort((a, b) => b[1] - a[1])) {
    console.warn(`  ${action.padEnd(24)} ${n}`);
  }

  const waiting = abandoned + inFlight;
  if (waiting) {
    // Not the true abandonment rate: Stripe does not report which succeeded
    // intents passed through requires_action, so the honest denominator is the
    // intents sitting at the step right now.
    const pct = Math.round((100 * abandoned) / waiting);
    console.log(`  ${pct}% of the intents at the authentication step are stalled`);
  }

  if (abandoned || headless) {
    console.warn('  repair: handle the returned status on the client, e.g. ' +
                 'await stripe.confirmPayment({elements, confirmParams: {return_url}})');
    console.warn('  repair: for server-confirmed flows call ' +
                 'stripe.handleNextAction({clientSecret}) with the returned secret');
    console.warn('  check: request the return_url directly and confirm it ' +
                 're-retrieves the intent by client_secret');
    console.warn('  check: stop launching 3DS inside a cross-origin iframe');
    console.warn(`  to close out the dead ones: POST ${API}/payment_intents/{id}/cancel ` +
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
