/**
 * Report a Connect platform with no webhook destination scoped to its accounts.
 *
 * Read only. Two GET requests and no writes: give this a RESTRICTED key with
 * read access to Webhook Endpoints and Connected accounts. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// The two events that only ever come from a connected account. The endpoint
// object does not return whether it was created with connect=true, so their
// absence proves a gap and their presence only shows somebody meant to.
const CONNECT_SIGNALS = ['account.updated', 'account.application.deauthorized'];

/**
 * Decide whether connected-account events have anywhere to go. Pure.
 * Returns [state, detail]. `inconclusive` is a real answer, not a failure.
 */
export function coverage(endpoints, isPlatform) {
  if (!isPlatform) {
    return ['not-a-platform',
      'no connected accounts on this key, so there is no Connect traffic to ' +
      'scope a destination for'];
  }

  const enabled = endpoints.filter((e) => e.status === 'enabled');
  const disabled = endpoints.length - enabled.length;

  if (enabled.length === 0) {
    return ['no-endpoints',
      `no enabled endpoint in this mode at all (${disabled} disabled): nothing ` +
      'is being delivered anywhere, connected or otherwise'];
  }

  const subscribed = new Set();
  const wildcards = [];
  for (const e of enabled) {
    const types = e.enabled_events ?? [];
    if (types.includes('*')) wildcards.push(e.url ?? e.id ?? '?');
    for (const t of types) subscribed.add(t);
  }

  const have = CONNECT_SIGNALS.filter((s) => subscribed.has(s));

  if (have.length === CONNECT_SIGNALS.length) {
    return ['covered', `an enabled endpoint subscribes to ${CONNECT_SIGNALS.join(' and ')}`];
  }

  if (wildcards.length && have.length === 0) {
    return ['inconclusive',
      `${wildcards.length} endpoint(s) subscribe to * and the endpoint object ` +
      'never returns whether they are Connect scoped: open ' +
      `${wildcards[0]} in Workbench and read whether it listens to your account ` +
      'or to connected accounts'];
  }

  if (have.length) {
    const missing = CONNECT_SIGNALS.filter((s) => !subscribed.has(s));
    const consequence = missing[0] === 'account.application.deauthorized'
      ? 'sellers who disconnect keep looking active'
      : 'you see the departures and none of the verification failures';
    return ['thin', `${have[0]} is subscribed but ${missing[0]} is not: ${consequence}`];
  }

  const tail = disabled ? `, and ${disabled} disabled endpoint(s) were ignored` : '';
  return ['uncovered',
    `no enabled endpoint subscribes to ${CONNECT_SIGNALS.join(' or ')}${tail}`];
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

async function endpoints(key) {
  const out = [];
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/webhook_endpoints', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more) return out;
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

  const eps = await endpoints(key);
  const accounts = await get(key, '/accounts', { limit: 1 });
  const isPlatform = (accounts.data ?? []).length > 0;

  const [state, detail] = coverage(eps, isPlatform);
  console.log(`${eps.length} endpoint(s), ` +
    `${isPlatform ? 'platform with connected accounts' : 'no connected accounts'}: ${state}`);

  if (state === 'covered' || state === 'not-a-platform') {
    console.log(`  ${detail}`);
    return;
  }

  console.warn(`  ${detail}`);
  console.warn('  repair: create a second destination scoped to connected accounts:');
  console.warn(`  POST ${API}/webhook_endpoints with connect=true, ` +
               'url=https://<yourdomain>/stripe/connect-webhook');
  console.warn('  enabled_events[]=account.updated ' +
               'enabled_events[]=account.application.deauthorized ' +
               'enabled_events[]=capability.updated ' +
               'enabled_events[]=person.updated enabled_events[]=payout.failed');
  console.warn('  in Workbench: Create an event destination, then Connected accounts');
  console.warn('  then: read the top-level account property on each event and make ' +
               'any follow-up call as that account');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
