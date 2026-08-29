/**
 * Report Stripe report runs whose interval reached past the finalized data window.
 *
 * Read only. Two GETs and no writes: give this a RESTRICTED key with read access
 * to Reports. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// An interval_end this close to data_available_end is not safely covered.
export const EDGE_HOURS = 1.0;
// Past this, the availability window itself is the problem.
export const STALE_HOURS = 36.0;

/**
 * Compare one requested interval against a report type's availability window.
 * Pure, so the boundary rules can be tested without a network.
 */
export function intervalState(intervalStart, intervalEnd, availableStart, availableEnd) {
  const missing = (v) => v === null || v === undefined;
  if (missing(availableEnd) || missing(intervalEnd)) {
    return ['unknown',
      'no data_available_end or no interval_end to compare; the run cannot be ' +
      'judged either way'];
  }
  if (intervalEnd > availableEnd) {
    const short = (intervalEnd - availableEnd) / 3600;
    return ['truncated',
      `interval_end is ${short.toFixed(1)} hour(s) past data_available_end; the ` +
      'run succeeded and returned less than it asked for'];
  }
  if (!missing(intervalStart) && !missing(availableStart) && intervalStart < availableStart) {
    const early = (availableStart - intervalStart) / 3600;
    return ['before_window',
      `interval_start is ${early.toFixed(1)} hour(s) before data_available_start; ` +
      'the earliest part of the range does not exist'];
  }
  const margin = (availableEnd - intervalEnd) / 3600;
  if (margin < EDGE_HOURS) {
    return ['at_edge',
      `interval_end is only ${margin.toFixed(2)} hour(s) inside data_available_end; ` +
      'this run was a coin flip and will be short on a slower night'];
  }
  return ['covered',
    `fully inside the available window, with ${margin.toFixed(1)} hour(s) to spare`];
}

/** Judge the availability window itself, independently of any run. Pure. */
export function freshnessState(availableEndAgeHours) {
  if (availableEndAgeHours === null || availableEndAgeHours === undefined) {
    return ['unknown', 'the report type reports no data_available_end'];
  }
  if (availableEndAgeHours >= STALE_HOURS) {
    return ['stale',
      `data_available_end is ${availableEndAgeHours.toFixed(1)} hour(s) behind now; ` +
      'Stripe has not finalized recent data, so defer rather than retry'];
  }
  return ['fresh',
    `data_available_end is ${availableEndAgeHours.toFixed(1)} hour(s) behind now, ` +
    'which is normal lag'];
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

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }
  const days = Number((process.env.DAYS || "dummy-days") ?? 14);
  const now = Date.now() / 1000;

  const types = new Map();
  for (const t of await pageAll(key, '/reporting/report_types', { limit: 100 })) {
    types.set(t.id, t);
  }
  const runs = await pageAll(key, '/reporting/report_runs',
    { limit: 100, 'created[gte]': Math.floor(now - days * 86400) });

  let bad = 0;
  const staleTypes = new Set();
  for (const r of runs) {
    const rt = types.get(r.report_type) ?? {};
    const params = r.parameters ?? {};
    const [state, detail] = intervalState(params.interval_start, params.interval_end,
      rt.data_available_start, rt.data_available_end);
    if (['truncated', 'before_window', 'at_edge'].includes(state)) {
      bad += 1;
      console.warn(`  ${state.padEnd(13)} ${r.id}  ${r.report_type}  ${detail}`);
    }
    const end = rt.data_available_end;
    const age = end === undefined || end === null ? null : (now - end) / 3600;
    if (freshnessState(age)[0] === 'stale') staleTypes.add(r.report_type);
  }

  for (const t of [...staleTypes].sort()) {
    const end = (types.get(t) ?? {}).data_available_end;
    const age = end === undefined || end === null ? null : (now - end) / 3600;
    console.warn(`  stale-window  ${t}  ${freshnessState(age)[1]}`);
  }

  if (!bad && staleTypes.size === 0) {
    console.log(`clear       ${runs.length} run(s) checked, all fully inside the ` +
                'available window');
    return;
  }

  console.warn(`short       ${bad} of ${runs.length} run(s) reached past what Stripe ` +
               'had finalized');
  console.warn('  availability only moves forward, so anything flagged here was ' +
               'definitely short when it ran');
  console.warn('  gate the job on the type before creating the run:');
  console.warn(`  GET ${API}/reporting/report_types/<type_id>   ` +
               '(create only while data_available_end >= interval_end)');
  console.warn('  and pin the version you depend on, e.g. balance.summary.1 rather ' +
               'than whichever is current');
  process.exitCode = 1;
}

// Only run when invoked directly, so importing this module from the test file
// does not fire main() and fail the suite on the missing key.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
