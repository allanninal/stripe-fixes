/**
 * Report Stripe webhook endpoints that share a URL and deliver every event twice.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access to
 * Webhook Endpoints and Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Reduce a webhook URL to the destination it actually is. Pure.
 *
 * Stripe's own API-version upgrade procedure tells you to create the second
 * endpoint with a query parameter, so the query string is exactly what makes a
 * duplicate look distinct. Strip it, strip a trailing slash, lowercase the host.
 */
export function normalise(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? '').trim());
  } catch {
    return String(url ?? '').trim();
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol.replace(':', '').toLowerCase()}://${parsed.host.toLowerCase()}${path}`;
}

/**
 * Classify one group of endpoints sharing a normalised URL and mode. Pure.
 */
export function verdict(group) {
  const items = group ?? [];
  if (items.length === 0) return ['unique', 'no endpoints'];
  const enabled = items.filter((e) => e.status === 'enabled');
  if (enabled.length > 1) {
    return ['duplicate',
      `${enabled.length} enabled endpoints on one URL: every subscribed event is ` +
      `delivered ${enabled.length} times and both signatures verify.`];
  }
  if (items.length > 1) {
    return ['residue',
      `${items.length} endpoint(s) on this URL, ${enabled.length} enabled. ` +
      'The disabled ones are leftovers, not duplicates.'];
  }
  return ['unique', `${enabled.length} enabled endpoint`];
}

export function groupEndpoints(endpoints) {
  const groups = new Map();
  for (const ep of endpoints) {
    const key = `${ep.livemode ? 'live' : 'test'} ${normalise(ep.url)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ep);
  }
  return groups;
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

  let bad = 0;
  for (const [label, group] of [...groupEndpoints(endpoints).entries()].sort()) {
    const [state, detail] = verdict(group);
    const line = `${state.padEnd(10)} ${label}  ${detail}`;
    if (state !== 'duplicate') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    for (const ep of group) {
      console.warn(`    ${ep.id}  ${ep.status}  version=` +
                   `${ep.api_version ?? 'account default'}  ` +
                   `${(ep.enabled_events ?? []).length} event type(s)`);
    }
    const keep = group[0].id;
    for (const ep of group.slice(1)) {
      console.warn(`  repair: keep ${keep}, then ` +
                   `POST ${API}/webhook_endpoints/${ep.id} -d disabled=true`);
    }
    console.warn('  then make the handler idempotent on event.id, which is ' +
                 'required regardless: Stripe delivers at least once.');
  }

  console.log(`${endpoints.length} endpoint(s), ${bad} duplicated URL group(s)`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
