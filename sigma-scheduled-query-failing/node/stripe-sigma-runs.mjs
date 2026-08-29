/**
 * Report Sigma scheduled query runs that failed, timed out, or stopped happening.
 *
 * Read only. Two paginated GETs and no writes: give this a RESTRICTED key with
 * read access to Sigma and Webhook Endpoints. The repair is printed, never
 * performed.
 */
const API = 'https://api.stripe.com/v1';

export const RUN_EVENT = 'sigma.scheduled_query_run.created';

// A schedule that has produced nothing for twice its cadence has stopped.
export const MISSED_CADENCES = 2.0;

/**
 * Classify one scheduled query run. Pure, so it can be tested offline.
 * `secondsUntilExpiry` is result_available_until minus now, or null.
 */
export function runState(status, error, secondsUntilExpiry) {
  if (status === 'completed') {
    if (secondsUntilExpiry !== null && secondsUntilExpiry !== undefined
        && secondsUntilExpiry <= 0) {
      return ['expired',
        `completed, but the result expired ${(-secondsUntilExpiry / 3600).toFixed(1)} ` +
        'hour(s) ago; the run succeeded and the file is gone'];
    }
    return ['completed', 'completed with a result still available'];
  }
  if (status === 'timed_out') {
    return ['timed_out',
      'the query ran past its execution budget; it will keep doing that until it ' +
      'is narrowed, because the data only grows'];
  }
  if (status === 'failed') {
    return ['failed', error || 'failed with no error message on the run'];
  }
  if (status === 'canceled') {
    return ['canceled', 'canceled, which is usually a person rather than a fault'];
  }
  return ['unknown', `unrecognised status ${JSON.stringify(status)}`];
}

/** Fold run states, schedule liveness and webhook coverage into one verdict. Pure. */
export function verdict(states, hoursSinceNewest, cadenceHours, runEventSubscribed) {
  const count = (s) => states.filter((x) => x === s).length;
  const broken = count('timed_out') + count('failed');
  const expired = count('expired');
  if (states.length === 0) {
    return ['silent',
      'no scheduled query runs at all; either no schedule exists or it has never ' +
      'produced a run'];
  }
  if (broken) {
    return ['failing',
      `${broken} of ${states.length} run(s) ended in timed_out or failed; narrow ` +
      'the query rather than retrying it'];
  }
  if (hoursSinceNewest !== null && hoursSinceNewest !== undefined
      && hoursSinceNewest > MISSED_CADENCES * cadenceHours) {
    return ['missing',
      `no run for ${hoursSinceNewest.toFixed(1)} hour(s) against a cadence of ` +
      `${cadenceHours.toFixed(0)} hour(s); the schedule has stopped producing runs`];
  }
  if (expired) {
    return ['expired_results',
      `${expired} completed run(s) whose result has already expired; the data is ` +
      'gone even though nothing failed'];
  }
  if (!runEventSubscribed) {
    return ['email_only',
      `${states.length} run(s), all completed, but nothing subscribes to ${RUN_EVENT}, ` +
      'so a run that stops happening has no signal at all'];
  }
  return ['clear',
    `${states.length} run(s), all completed, results consumed by webhook`];
}

async function get(key, path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (res.status === 403) {
    throw new Error('403 from Stripe: no read access to Sigma, or Sigma is not enabled');
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

export function runEventIsSubscribed(endpoints) {
  return endpoints.some((ep) => ep.status !== 'disabled'
    && (ep.enabled_events ?? []).some((e) => e === RUN_EVENT || e === '*'));
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }
  const cadenceHours = Number((process.env.CADENCE_HOURS || "dummy-cadence-hours") ?? 24);
  const now = Date.now() / 1000;

  const runs = await pageAll(key, '/sigma/scheduled_query_runs', { limit: 100 }, 200);

  const states = [];
  let newest = null;
  for (const r of runs) {
    const until = r.result_available_until;
    const left = until === undefined || until === null ? null : until - now;
    const [state, detail] = runState(r.status, r.error, left);
    states.push(state);
    if (r.data_load_time != null && (newest === null || r.data_load_time > newest)) {
      newest = r.data_load_time;
    }
    if (state !== 'completed') {
      console.warn(`  ${state.padEnd(9)} ${r.id}  ${r.title ?? '<untitled>'}  ${detail}`);
    }
  }

  const hoursSince = newest === null ? null : (now - newest) / 3600;
  const endpoints = await pageAll(key, '/webhook_endpoints', { limit: 100 });
  const subscribed = runEventIsSubscribed(endpoints);

  const [state, detail] = verdict(states, hoursSince, cadenceHours, subscribed);
  const line = `${state.padEnd(11)} ${detail}`;
  if (state === 'clear') { console.log(line); return; }

  console.warn(line);
  if (['failing', 'missing', 'silent'].includes(state)) {
    console.warn('  narrow the query in Dashboard > Data > Sigma: add a created >= ' +
                 'bound, drop wide joins, select fewer columns, then re-save it');
  }
  if (!subscribed) {
    console.warn('  consume results programmatically instead of by email:');
    console.warn(`  POST ${API}/webhook_endpoints/<we_id> enabled_events[]=${RUN_EVENT}`);
    console.warn('  then GET https://files.stripe.com/v1/files/<file_id>/contents ' +
                 'before result_available_until');
  }
  process.exitCode = 1;
}

// Only run when invoked directly, so importing this module from the test file
// does not fire main() and fail the suite on the missing key.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
