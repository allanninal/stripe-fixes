/**
 * Report Stripe webhook endpoints rendering events at different api_versions.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Webhook Endpoints. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Both spellings of "this endpoint has no pin" collapse here, before anything
// deduplicates. An account with two unpinned endpoints has one shape, not two.
export const ACCOUNT_DEFAULT = 'account default';

/**
 * Map an endpoint's raw api_version onto the shape it actually renders. Pure.
 * Stripe returns null on some unpinned endpoints and '' on others.
 */
export function normalise(apiVersion) {
  if (apiVersion === null || apiVersion === undefined || apiVersion === '') {
    return ACCOUNT_DEFAULT;
  }
  return String(apiVersion);
}

/** The URL without its query string or fragment. Pure. */
export function baseUrl(url) {
  return String(url ?? '').split('?')[0].split('#')[0];
}

/**
 * Classify a whole account's endpoints. Pure, so both traps are testable.
 * `endpoints` is an array of objects with url, api_version and status.
 */
export function verdict(endpoints) {
  const live = endpoints.filter((e) => e.status === 'enabled');
  if (live.length === 0) {
    return ['none',
      'no enabled endpoints in this mode: nothing is being delivered, so ' +
      'nothing can disagree about a shape'];
  }

  const versions = [...new Set(live.map((e) => normalise(e.api_version)))].sort();
  if (versions.length === 1) {
    return ['consistent',
      `all ${live.length} enabled endpoint(s) render at ${versions[0]}`];
  }

  const byUrl = new Map();
  for (const e of live) {
    const u = baseUrl(e.url);
    if (!byUrl.has(u)) byUrl.set(u, new Set());
    byUrl.get(u).add(normalise(e.api_version));
  }
  const shared = [...byUrl.entries()].filter(([, v]) => v.size > 1)
    .map(([u]) => u).sort();
  if (shared.length > 0) {
    return ['migration',
      `${versions.length} versions in use (${versions.join(', ')}), and ` +
      `${shared[0]} is served at more than one of them. That is the ` +
      'dual-endpoint upgrade shape, still running: the handler is being sent ' +
      'every event twice, in two shapes.'];
  }
  return ['drift',
    `${versions.length} versions in use (${versions.join(', ')}) across ` +
    `${live.length} endpoint(s) on different URLs. The same event reaches your ` +
    'services in different shapes and only the ones reading a moved field will fail.'];
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

export async function endpoints(key) {
  const out = [];
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/webhook_endpoints', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const eps = await endpoints(key);
  if (eps.length === 0) {
    console.log("no webhook endpoints configured for this key's mode");
    return;
  }

  const [state, detail] = verdict(eps);
  for (const ep of eps) {
    if (ep.status !== 'enabled') continue;
    console.log(`  ${String(ep.status).padEnd(9)} ` +
                `${normalise(ep.api_version).padEnd(24)} ${ep.url ?? '?'}`);
  }

  if (state === 'consistent' || state === 'none') {
    console.log(`${state}  ${detail}`);
    return;
  }

  console.warn(`${state}  ${detail}`);
  console.warn('  api_version cannot be edited, so the repair is a cutover, not ' +
               'an update: pick the version every consumer should be on');
  console.warn(`  disable the losing endpoint: POST ${API}/webhook_endpoints/{id} ` +
               '-d disabled=true');
  console.warn(`  once nothing depends on it, remove it: DELETE ${API}/` +
               'webhook_endpoints/{id}');
  console.warn('  then pin the survivor deliberately rather than leaving it on ' +
               'the account default, which moves at the next upgrade');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
