/**
 * Report whether payout.failed is subscribed, and whether payouts already failed.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access to
 * Webhook Endpoints, Payouts and Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const TARGET = 'payout.failed';
const COMPANION = 'payout.paid';

/**
 * Classify payout-failure coverage. Pure, so the rules can be tested.
 * `subscribed` is the union of enabled_events across every endpoint.
 */
export function verdict(subscribed, failedPayouts) {
  const events = new Set(subscribed ?? []);
  if (events.has('*')) {
    return ['wildcard',
      `a wildcard subscription covers ${TARGET}, but it also delivers every ` +
      'other event type to the same handler.'];
  }
  if (events.has(TARGET)) {
    if (!events.has(COMPANION)) {
      return ['partial',
        `${TARGET} is subscribed but ${COMPANION} is not. Reconciliation cannot ` +
        'tell a quiet week from a broken one.'];
    }
    return ['covered', `${TARGET} is subscribed on at least one endpoint`];
  }
  if (failedPayouts) {
    return ['blind',
      `${failedPayouts} payout(s) already failed and nothing subscribes to ` +
      `${TARGET}. The external account is disabled until the details are updated.`];
  }
  return ['unsubscribed',
    `nothing subscribes to ${TARGET}. No failures in the window yet, so this is ` +
    'a gap rather than an incident.'];
}

export function subscribedEvents(endpoints) {
  const union = new Set();
  for (const ep of endpoints ?? []) {
    for (const e of ep.enabled_events ?? []) union.add(e);
  }
  return union;
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

export async function failedPayouts(key, limit = 500) {
  const codes = new Map();
  let count = 0;
  const params = { limit: 100, status: 'failed' };
  for (;;) {
    const page = await get(key, '/payouts', params);
    const data = page.data ?? [];
    for (const p of data) {
      count += 1;
      const code = p.failure_code ?? 'unknown';
      codes.set(code, (codes.get(code) ?? 0) + 1);
    }
    if (data.length === 0 || !page.has_more || count >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { count, codes };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const { data: endpoints = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  const union = subscribedEvents(endpoints);
  const { count, codes } = await failedPayouts(key);

  const [state, detail] = verdict(union, count);
  const line = `${state.padEnd(13)} ${detail}`;
  if (state === 'covered') { console.log(line); return; }

  console.warn(line);
  if (codes.size > 0) {
    const seen = [...codes.entries()].sort().map(([c, n]) => `${c} x${n}`).join(', ');
    console.warn(`  failure codes seen: ${seen}`);
  }
  const target = endpoints.length > 0 ? endpoints[0].id : '<we_id>';
  console.warn(`  repair: POST ${API}/webhook_endpoints/${target} ` +
               `-d enabled_events[]=${TARGET} -d enabled_events[]=${COMPANION}`);
  console.warn('  on Connect, add a connected-accounts destination carrying ' +
               `${TARGET} and account.external_account.updated`);
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
