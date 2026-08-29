/**
 * Report webhook endpoints subscribed to charge events on a PaymentIntent integration.
 *
 * Read only. Two GETs, no writes: give this a RESTRICTED key with read access to
 * Webhook Endpoints and Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const CHARGE = 'charge.succeeded';
const INTENT = 'payment_intent.succeeded';
const SESSION = 'checkout.session.completed';

/**
 * Classify one endpoint's fulfilment subscription. Pure and testable.
 * Checked in order of how much fulfilment they cost you: a missing path first,
 * then a duplicated one.
 */
export function verdict(enabledEvents, firedTypes) {
  const events = new Set(enabledEvents ?? []);
  const fired = new Set(firedTypes ?? []);
  const modern = events.has(INTENT) || events.has(SESSION);

  if (events.has('*')) {
    return ['wildcard',
      'a wildcard delivers both shapes of the same payment. Fulfilment has to ' +
      'pick one and ignore the other, explicitly.'];
  }

  if (events.has(CHARGE) && !modern) {
    const seen = [INTENT, SESSION].filter((t) => fired.has(t));
    if (seen.length > 0) {
      return ['stale',
        `${CHARGE} is the only success subscription, but ${seen.join(', ')} ` +
        'fired in the retained window. The Charge carries neither the intent ' +
        'metadata nor client_reference_id.'];
    }
    return ['legacy',
      `${CHARGE} only, and no PaymentIntent or Checkout events fired. This ` +
      'looks like a genuine Charges API integration rather than a stale subscription.'];
  }

  if (fired.has(SESSION) && !events.has(SESSION)) {
    return ['checkout-gap',
      `Checkout Sessions are completing and ${SESSION} is not subscribed. No ` +
      'charge or payment_intent subscription implies it.'];
  }

  if (events.has(CHARGE) && modern) {
    return ['overlapping',
      `${CHARGE} and the fulfilment event are both subscribed, so one payment ` +
      'arrives twice in two shapes. Fulfil on one and drop the other.'];
  }

  return ['aligned', 'fulfilment events match the integration'];
}

async function get(key, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
    else url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export async function modernTypesSeen(key) {
  const page = await get(key, '/events', { limit: 100, 'types[]': [INTENT, SESSION] });
  return new Set((page.data ?? []).map((ev) => ev.type));
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const { data: endpoints = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  if (endpoints.length === 0) {
    console.log("no webhook endpoints configured for this key's mode");
    return;
  }

  const fired = await modernTypesSeen(key);
  console.log(`modern success types seen: ${[...fired].sort().join(', ') || 'none'}`);

  let bad = 0;
  for (const ep of endpoints) {
    const [state, detail] = verdict(ep.enabled_events, fired);
    const line = `${state.padEnd(12)} ${ep.url ?? '?'}  ${detail}`;
    if (state === 'aligned' || state === 'legacy') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    const want = fired.has(SESSION) ? SESSION : INTENT;
    console.warn(`  repair: add enabled_events[]=${want} to ` +
                 `${API}/webhook_endpoints/${ep.id}, ship the handler branch, ` +
                 `then remove ${CHARGE}`);
  }

  console.log(`${endpoints.length} endpoint(s), ${bad} needing attention`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
