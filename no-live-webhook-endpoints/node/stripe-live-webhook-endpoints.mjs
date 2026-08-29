/**
 * Report whether this mode has a webhook endpoint at all, and whether it needs one.
 *
 * Read only. Two GETs, no writes: give this a RESTRICTED key with read access to
 * Webhook Endpoints and Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const TRAFFIC_TYPES = ['payment_intent.succeeded', 'checkout.session.completed',
  'invoice.paid'];

/**
 * Classify webhook coverage for one mode. Pure, so the rules can be tested.
 */
export function verdict(endpoints, paymentEvents, livemode) {
  const eps = endpoints ?? [];
  const enabled = eps.filter((e) => e.status === 'enabled');
  if (eps.length === 0) {
    if (paymentEvents) {
      return ['blind',
        `${paymentEvents} payment event(s) in the retained window and no webhook ` +
        'endpoint to receive them. Stripe had nowhere to push, so nothing that ' +
        'should follow a payment ever ran.'];
    }
    return ['empty',
      'no webhook endpoint, and no payment events in the retained window either. ' +
      'Nothing has been lost yet: create the endpoint before the first real ' +
      'payment rather than after it.'];
  }
  if (enabled.length === 0) {
    return ['all-disabled',
      `${eps.length} endpoint(s) exist and every one of them is disabled, which ` +
      'delivers exactly as much as having none.'];
  }
  if (!livemode) {
    return ['test-mode',
      `${enabled.length} enabled endpoint(s), all test mode. A healthy test mode ` +
      'is what lets this ship: re-run with a live restricted key before ' +
      'concluding anything about production.'];
  }
  return ['covered', `${enabled.length} enabled endpoint(s) in this mode`];
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
  if (res.status === 403) {
    throw new Error(`403 from Stripe: the restricted key lacks read access to ${path}`);
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export function isLivemode(key) {
  return !/^(sk|rk|pk)_test_/.test(key);
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const { data: endpoints = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  const { data: events = [] } = await get(key, '/events',
    { limit: 100, 'types[]': TRAFFIC_TYPES });

  let livemode = isLivemode(key);
  for (const obj of [...endpoints, ...events]) {
    if ('livemode' in obj) { livemode = Boolean(obj.livemode); break; }
  }

  const [state, detail] = verdict(endpoints, events.length, livemode);
  const line = `${state.padEnd(12)} ${detail}`;
  if (state === 'covered') {
    console.log(line);
    for (const ep of endpoints) {
      console.log(`  ${ep.url ?? '?'}  ${(ep.enabled_events ?? []).length} subscribed type(s)`);
    }
    return;
  }

  console.warn(line);
  if (state === 'blind' || state === 'empty') {
    console.warn(`  repair: POST ${API}/webhook_endpoints`);
    console.warn('    -d url=https://<your-domain>/stripe/webhook');
    console.warn('    -d enabled_events[]=payment_intent.succeeded');
    console.warn('    -d enabled_events[]=payment_intent.payment_failed');
    console.warn('  then copy the secret from the response into the server ' +
                 'environment: the whsec_ printed by the CLI is not it');
  }
  if (state === 'blind') {
    console.warn(`  backfill: GET ${API}/charges?created[gte]=<unix> and ` +
                 `${API}/invoices?created[gte]=<unix>, which are not retention ` +
                 'limited the way /v1/events is');
  }
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
