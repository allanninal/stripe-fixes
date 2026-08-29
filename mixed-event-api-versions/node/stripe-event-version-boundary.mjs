/**
 * Report a version boundary inside the retained Stripe event stream.
 *
 * Read only. Two paginated GETs and no writes: give this a RESTRICTED key with
 * read access to Events and Webhook Endpoints. The repair is a code change and
 * is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// An event with no api_version gets its own bucket rather than being dropped.
// Dropping it hides the transition that produced it.
export const UNREPORTED = 'unreported';

/** One event's version, with a bucket for the absent case. Pure. */
export function label(apiVersion) {
  if (apiVersion === null || apiVersion === undefined || apiVersion === '') {
    return UNREPORTED;
  }
  return String(apiVersion);
}

/**
 * Classify the window. Pure, so the ordering logic can be tested offline.
 * `events` is an array of objects with api_version and created, NEWEST FIRST,
 * which is the order the events API returns.
 */
export function verdict(events) {
  if (!events || events.length === 0) {
    return ['empty', 'no events in the window: nothing to compare'];
  }

  const seq = events.map((e) => label(e.api_version));
  const distinct = [...new Set(seq)].sort();
  if (distinct.length === 1) {
    return ['single',
      `every one of the ${seq.length} event(s) sampled rendered at ${distinct[0]}`];
  }

  const transitions = [];
  for (let i = 0; i < seq.length - 1; i += 1) {
    if (seq[i] !== seq[i + 1]) transitions.push([events[i].created, seq[i + 1], seq[i]]);
  }

  if (transitions.length === 1) {
    const [at, older, newer] = transitions[0];
    return ['boundary',
      `two shapes in the window: ${older} up to created=${at}, ${newer} from ` +
      'there on. Any backfill across this window walks through both.'];
  }
  return ['churn',
    `${transitions.length} transitions between ${distinct.length} versions ` +
    `(${distinct.join(', ')}). That is an upgrade followed by a rollback inside ` +
    'the 72 hour window: the shape alternates rather than changing once.'];
}

/**
 * Did the boundary reach a handler? Pure. `endpointVersions` is the raw
 * api_version of each enabled endpoint.
 */
export function exposure(endpointVersions) {
  if (!endpointVersions || endpointVersions.length === 0) {
    return ['no-endpoints',
      'no enabled endpoints: the boundary only affects code reading the events ' +
      'API directly'];
  }
  const unpinned = endpointVersions.filter(
    (v) => v === null || v === undefined || v === '');
  if (unpinned.length > 0) {
    return ['inherited',
      `${unpinned.length} of ${endpointVersions.length} enabled endpoint(s) are ` +
      'unpinned and follow the account default, so the boundary was delivered ' +
      'to your handler'];
  }
  return ['pinned',
    `all ${endpointVersions.length} enabled endpoint(s) are pinned, so delivered ` +
    'payloads keep one shape. The boundary shows up in replays and backfills.'];
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

export async function sampleEvents(key, limit = 5000) {
  const out = [];
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/events', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

export async function enabledEndpointVersions(key) {
  const out = [];
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/webhook_endpoints', params);
    const data = page.data ?? [];
    for (const e of data) if (e.status === 'enabled') out.push(e.api_version);
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

  const events = await sampleEvents(key);
  const [state, detail] = verdict(events);
  const [reach, reachDetail] = exposure(await enabledEndpointVersions(key));

  console.log(`  sampled ${events.length} event(s)`);
  console.log(`  ${reach.padEnd(12)} ${reachDetail}`);

  if (state === 'single' || state === 'empty') {
    console.log(`${state}  ${detail}`);
    return;
  }

  console.warn(`${state}  ${detail}`);
  console.warn('  there is no Stripe-side repair: stored events are immutable ' +
               'and are never re-rendered');
  console.warn('  branch on event.api_version for the 30 days the two shapes ' +
               'coexist, then delete the branch');
  console.warn('  or stop trusting data.object during the overlap and re-fetch ' +
               "the object by id, which is rendered at your request's version");
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
