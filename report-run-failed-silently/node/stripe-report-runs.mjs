/**
 * Report Stripe report runs that failed, stalled in pending, or never happened.
 *
 * Read only. Two paginated GETs and no writes: give this a RESTRICTED key with
 * read access to Reports and Webhook Endpoints. The repair is printed, never
 * performed.
 */
const API = 'https://api.stripe.com/v1';

// A run still pending past this is not being worked on.
export const STALL_SECONDS = 3600;
export const FAILURE_EVENT = 'reporting.report_run.failed';

/**
 * Classify one report run. Pure, so the pending deadline can be tested offline.
 * `ageSeconds` is how long ago the run was created.
 */
export function runState(status, ageSeconds, error = null) {
  if (status === 'succeeded') return ['succeeded', 'finished, result file available'];
  if (status === 'failed') {
    return ['failed', error || 'failed with no error message on the run'];
  }
  if (status === 'pending') {
    if (ageSeconds !== null && ageSeconds !== undefined && ageSeconds >= STALL_SECONDS) {
      return ['stalled',
        `pending for ${(ageSeconds / 3600).toFixed(1)} hour(s); nothing is working ` +
        'on it, treat it as failed'];
    }
    return ['running', `pending, still inside the ${STALL_SECONDS} second window`];
  }
  return ['unknown', `unrecognised status ${JSON.stringify(status)}`];
}

/** Fold run states, schedule gaps and webhook coverage into one verdict. Pure. */
export function verdict(states, missingDays, failureSubscribed) {
  const failed = states.filter((s) => s === 'failed').length;
  const stalled = states.filter((s) => s === 'stalled').length;
  if (states.length === 0) {
    return ['silent',
      'no report runs at all in the window; the export never reached Stripe, so ' +
      'there is nothing here to have failed'];
  }
  if (failed || stalled) {
    return ['failing',
      `${states.length} run(s): ${failed} failed, ${stalled} stalled in pending, ` +
      `${missingDays.length} expected day(s) with no successful run`];
  }
  if (missingDays.length) {
    return ['gaps',
      `${states.length} run(s), none failed, but ${missingDays.length} expected ` +
      `day(s) have no successful run: ${missingDays.slice(0, 5).join(', ')}`];
  }
  if (!failureSubscribed) {
    return ['unwatched',
      `${states.length} run(s), all successful, but nothing subscribes to ` +
      `${FAILURE_EVENT}, so the next failure is silent`];
  }
  return ['clear',
    `${states.length} run(s), 0 failed, 0 stalled, no missing days, failures subscribed`];
}

async function get(key, path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (res.status === 403) {
    throw new Error('403 from Stripe: the restricted key has no read access here');
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

async function pageAll(key, path, params, cap = 2000) {
  const out = [];
  const p = { ...params };
  for (;;) {
    const page = await get(key, path, p);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= cap) return out;
    p.starting_after = data[data.length - 1].id;
  }
}

const utcDay = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);

export function expectedDays(now, days) {
  const out = [];
  for (let n = 1; n <= days; n += 1) out.push(utcDay(now - n * 86400));
  return out;
}

export function failureIsSubscribed(endpoints) {
  return endpoints.some((ep) => ep.status !== 'disabled'
    && (ep.enabled_events ?? []).some((e) => e === FAILURE_EVENT || e === '*'));
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }
  const days = Number((process.env.DAYS || "dummy-days") ?? 30);
  const now = Date.now() / 1000;

  const runs = await pageAll(key, '/reporting/report_runs',
    { limit: 100, 'created[gte]': Math.floor(now - days * 86400) });

  const states = [];
  const succeededDays = new Set();
  for (const r of runs) {
    const age = r.created === undefined ? null : now - r.created;
    const [state, detail] = runState(r.status, age, r.error);
    states.push(state);
    if (state === 'succeeded' && r.succeeded_at) succeededDays.add(utcDay(r.succeeded_at));
    if (['failed', 'stalled', 'unknown'].includes(state)) {
      console.warn(`  ${state.padEnd(9)} ${r.id}  ${r.report_type}  ${detail}`);
    }
  }
  const missing = expectedDays(now, days).filter((d) => !succeededDays.has(d));

  const endpoints = await pageAll(key, '/webhook_endpoints', { limit: 100 });
  const subscribed = failureIsSubscribed(endpoints);

  const [state, detail] = verdict(states, missing, subscribed);
  const line = `${state.padEnd(11)} ${detail}`;
  if (state === 'clear') { console.log(line); return; }

  console.warn(line);
  console.warn('  read the reason off the run, then re-issue it:');
  console.warn(`  GET ${API}/reporting/report_runs/<frr_id>   (read .error, .parameters)`);
  console.warn(`  POST ${API}/reporting/report_runs with the corrected interval, then ` +
               'poll until status leaves pending');
  if (!subscribed) {
    console.warn('  and subscribe an endpoint so the next one is loud:');
    console.warn(`  POST ${API}/webhook_endpoints/<we_id> enabled_events[]=${FAILURE_EVENT}` +
                 ' enabled_events[]=reporting.report_run.succeeded');
  }
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
