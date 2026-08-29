/**
 * Report Stripe webhook endpoints that are disabled or losing events.
 *
 * Read only. Two GET requests, no writes: give this a RESTRICTED key with read
 * access to Webhook Endpoints and Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one endpoint. Pure, so the rules can be tested without a network.
 */
export function verdict(endpoint, undelivered) {
  const status = endpoint.status;
  if (status === 'disabled') {
    return ['disabled',
      'Stripe stopped delivering after repeated failures. Re-enable only after ' +
      'the handler answers 2xx.'];
  }
  if (status !== 'enabled') {
    return ['unknown', `unrecognised status ${JSON.stringify(status)}`];
  }
  if (undelivered) {
    return ['failing',
      `${undelivered} event(s) did not deliver. The endpoint is still enabled, ` +
      'so you have time before Stripe disables it.'];
  }
  return ['healthy', 'delivering normally'];
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

export async function undeliveredByEndpoint(key, limit = 1000) {
  const counts = new Map();
  let total = 0;
  const params = { delivery_success: 'false', limit: 100 };
  for (;;) {
    const page = await get(key, '/events', params);
    for (const ev of page.data ?? []) {
      total += 1;
      for (const dest of ev.pending_webhooks_destinations ?? []) {
        counts.set(dest, (counts.get(dest) ?? 0) + 1);
      }
    }
    if (!page.has_more || total >= limit) break;
    params.starting_after = page.data[page.data.length - 1].id;
  }
  return { counts, total };
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

  const { counts, total } = await undeliveredByEndpoint(key);

  let bad = 0;
  for (const ep of endpoints) {
    const [state, detail] = verdict(ep, counts.get(ep.id) ?? 0);
    const line = `${state.padEnd(9)} ${ep.url ?? '?'}  ${detail}`;
    if (state === 'healthy') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    if (state === 'disabled') {
      console.warn(`  repair: POST ${API}/webhook_endpoints/${ep.id} -d disabled=false`);
      console.warn(`  then replay: GET ${API}/events?delivery_success=false`);
    }
  }

  console.log(`${endpoints.length} endpoint(s), ${bad} needing attention, ` +
              `${total} undelivered event(s)`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
