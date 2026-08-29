/**
 * Report Stripe webhook endpoints pinned to an outdated api_version.
 *
 * Read only. One GET and no writes: give this a RESTRICTED key with read access
 * to Webhook Endpoints. The migration is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const CURRENT_LINE = '2025-09-30'; // Clover
const ACACIA = '2024-09-30';              // breaking changes from here on
const DATE = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Classify one endpoint's pin. Pure, so the string handling can be tested.
 * `apiVersion` is the raw field: null or '' when the endpoint is unpinned.
 */
export function verdict(apiVersion, currentLine = CURRENT_LINE) {
  if (apiVersion === null || apiVersion === undefined || apiVersion === '') {
    return ['unpinned',
      'no api_version: events render at the account default, which moves under ' +
      'this endpoint whenever the account is upgraded'];
  }
  const m = DATE.exec(String(apiVersion));
  if (!m) {
    return ['unreadable',
      `api_version ${apiVersion} has no YYYY-MM-DD prefix to compare`];
  }
  const date = m[1];
  if (date < ACACIA) {
    return ['ancient',
      `pinned to ${date}, before the ${ACACIA} Acacia line. Typed SDKs ` +
      'deserialize this into empty objects without throwing.'];
  }
  if (date < currentLine) {
    return ['stale',
      `pinned to ${date}, behind the current ${currentLine} line. Check the ` +
      'changelog for the fields your handler reads.'];
  }
  return ['current', `pinned to ${date}, on the current line`];
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

  let bad = 0;
  for (const ep of eps) {
    const [state, detail] = verdict(ep.api_version);
    const line = `${state.padEnd(10)} ${ep.url ?? '?'}  ${detail}`;
    if (state === 'current' || state === 'unpinned') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    console.warn(`  api_version is not updatable: POST ${API}/webhook_endpoints/` +
                 `${ep.id} accepts only url, enabled_events, description, ` +
                 'metadata, disabled');
    console.warn('  migrate instead: create a second endpoint on the same url ' +
                 `with a distinguishing query param and api_version=${CURRENT_LINE}, ` +
                 'keeping enabled_events identical');
    console.warn(`  then, once the new shape is handled: POST ${API}/` +
                 `webhook_endpoints/${ep.id} -d disabled=true`);
  }

  console.log(`${eps.length} endpoint(s), ${bad} on an outdated pin`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
