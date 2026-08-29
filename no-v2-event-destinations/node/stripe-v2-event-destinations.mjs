/**
 * Report a Stripe account with no v2 event destination for thin events.
 *
 * Read only. Two GETs and no writes: give this a RESTRICTED key with read access
 * to Event Destinations and Billing Meters. The repair is printed, never performed.
 */
const API_V1 = 'https://api.stripe.com/v1';
const API_V2 = 'https://api.stripe.com/v2';

// Sent explicitly. The account default may predate v2 entirely, in which case the
// v2 path errors instead of returning an empty list.
const DEFAULT_VERSION = '2025-03-31.basil';

/**
 * Classify an account's v2 event destinations. Pure, so it is testable offline.
 * The same empty list is a gap or an outage depending on `v2FeatureInUse`.
 */
export function verdict(destinations, v2FeatureInUse = false) {
  const dests = destinations ?? [];
  const thin = dests.filter((d) => d.event_payload === 'thin');
  const enabled = thin.filter((d) => d.status === 'enabled');
  if (enabled.length) {
    return ['covered', `${enabled[0].id ?? '<no id>'} is enabled and takes thin events`];
  }
  if (thin.length) {
    const d = thin[0];
    return ['disabled',
      `${d.id ?? '<no id>'} takes thin events but its status is ` +
      `${JSON.stringify(d.status)}: ${d.status_details ?? 'no status_details given'}`];
  }
  if (dests.length) {
    return ['snapshot-only',
      `${dests.length} event destination(s) exist and every one of them is ` +
      'event_payload=snapshot, which cannot carry a thin event'];
  }
  if (v2FeatureInUse) {
    return ['dropping',
      'no v2 event destination at all, and a v2 feature is in use: the thin ' +
      'events it emits are being generated and delivered nowhere'];
  }
  return ['none',
    'no v2 event destination exists. Nothing emits thin events yet, so nothing ' +
    'is being lost today.'];
}

async function get(key, url, params = {}, version = null) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers = { Authorization: `Bearer ${key}` };
  if (version) headers['Stripe-Version'] = version;
  const res = await fetch(u, { headers });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if ((res.status === 400 || res.status === 404) && u.pathname.startsWith('/v2/')) {
    throw new Error(`${res.status} from ${u.pathname}: this key or API version ` +
                    'cannot see v2 resources');
  }
  if (!res.ok) throw new Error(`${res.status} from ${u.pathname}`);
  return res.json();
}

/**
 * The v2 list endpoints paginate with an absolute next_page_url rather than the
 * starting_after cursor the v1 list endpoints use.
 */
export async function eventDestinations(key, version = DEFAULT_VERSION) {
  const out = [];
  let url = `${API_V2}/core/event_destinations`;
  let params = { limit: 100 };
  while (url) {
    const page = await get(key, url, params, version);
    out.push(...(page.data ?? []));
    url = page.next_page_url ?? null;
    params = {};
  }
  return out;
}

export async function v2FeatureInUse(key) {
  const page = await get(key, `${API_V1}/billing/meters`, { limit: 1 });
  return (page.data ?? []).length > 0;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const version = process.argv[2] ?? DEFAULT_VERSION;
  const dests = await eventDestinations(key, version);
  const inUse = await v2FeatureInUse(key);
  const [state, detail] = verdict(dests, inUse);

  console.log(`${state.padEnd(16)} ${detail}`);
  for (const d of dests) {
    console.log(`  ${d.id}  payload=${d.event_payload}  status=${d.status}  ` +
                `events_from=${JSON.stringify(d.events_from ?? null)}`);
  }
  if (state === 'covered') return;

  if (state === 'disabled') {
    console.warn('  repair: fix the handler, then re-enable the destination at ' +
                 `${API_V2}/core/event_destinations/<id>/enable`);
    process.exitCode = 1;
    return;
  }

  console.warn('  repair: create a thin destination (a separate object from any ' +
               '/v1/webhook_endpoints you already have):');
  console.warn(`  POST ${API_V2}/core/event_destinations -d type=webhook_endpoint ` +
               '-d event_payload=thin -d "events_from[]=@self" ' +
               '-d "enabled_events[]=v1.billing.meter.error_report_triggered" ' +
               '-d webhook_endpoint[url]=https://<yourdomain>/stripe/thin-webhook ' +
               '-d "include[]=webhook_endpoint.signing_secret"');
  console.warn('  the signing secret is returned once, on create, and only if you ' +
               'ask for it with include[]');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
