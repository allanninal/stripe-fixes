/**
 * Report whether dispute and early fraud warning events are subscribed anywhere.
 *
 * Read only. Three GETs, no writes: give this a RESTRICTED key with read access
 * to Webhook Endpoints, Disputes and Radar. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const DISPUTE = 'charge.dispute.created';
const DISPUTE_CLOSED = 'charge.dispute.closed';
const FRAUD = 'radar.early_fraud_warning.created';

/**
 * Classify dispute and fraud coverage. Pure, so the rules can be tested.
 */
export function verdict(subscribed, disputes, warnings) {
  const events = new Set(subscribed ?? []);
  if (events.has('*')) {
    return ['wildcard',
      'a wildcard subscription covers both signals, but it also delivers every ' +
      'other event type to the same handler.'];
  }
  if (!events.has(DISPUTE)) {
    if (disputes) {
      return ['blind',
        `${disputes} dispute(s) on this account and nothing subscribes to ` +
        `${DISPUTE}. Every response deadline so far was found by email.`];
    }
    return ['unsubscribed',
      `nothing subscribes to ${DISPUTE}. No disputes yet, so this is a gap ` +
      'rather than a deadline already running.'];
  }
  if (!events.has(FRAUD)) {
    if (warnings) {
      return ['fraud-blind',
        `${warnings} early fraud warning(s) already raised and nothing subscribes ` +
        `to ${FRAUD}. A refund during that window prevents the chargeback outright.`];
    }
    return ['dispute-only',
      `${DISPUTE} is subscribed but ${FRAUD} is not. You will hear about ` +
      'chargebacks after they are filed and never before.'];
  }
  if (!events.has(DISPUTE_CLOSED)) {
    return ['partial',
      `both opening signals are subscribed but ${DISPUTE_CLOSED} is not, so ` +
      'nothing tells you how a dispute ended.'];
  }
  return ['covered', `${DISPUTE} and ${FRAUD} subscribed`];
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

/** Union of enabled_events across endpoints. Pure, given the endpoint list. */
export function subscribedEvents(endpoints) {
  const union = new Set();
  for (const ep of endpoints ?? []) {
    for (const t of ep.enabled_events ?? []) union.add(t);
  }
  return union;
}

async function countRecords(key, path, limit = 500) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, path, params);
    const data = page.data ?? [];
    seen += data.length;
    if (data.length === 0 || !page.has_more || seen >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return seen;
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
  const disputes = await countRecords(key, '/disputes');
  const warnings = await countRecords(key, '/radar/early_fraud_warnings');

  const [state, detail] = verdict(union, disputes, warnings);
  const line = `${state.padEnd(13)} ${detail}`;
  if (state === 'covered') {
    console.log(line);
    return;
  }

  console.warn(line);
  console.warn(`  ${disputes} dispute(s), ${warnings} early fraud warning(s) on this account`);
  if (state !== 'wildcard') {
    console.warn(`  repair: POST ${API}/webhook_endpoints/${endpoints[0]?.id ?? '<we_id>'}`);
    for (const t of [DISPUTE, DISPUTE_CLOSED, FRAUD]) {
      if (!union.has(t)) console.warn(`    -d enabled_events[]=${t}`);
    }
    console.warn('    (enabled_events is replaced wholesale: send the existing types too)');
  }
  console.warn(`  then sweep GET ${API}/disputes and ${API}/radar/early_fraud_warnings ` +
               'once: neither is retention limited the way /v1/events is');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
