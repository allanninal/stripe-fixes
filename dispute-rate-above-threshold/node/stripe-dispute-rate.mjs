/**
 * Measure the Stripe dispute rate against the card network thresholds.
 *
 * Read only. Three paginated GETs and no writes: give this a RESTRICTED key
 * with read access to Disputes, Charges and Early Fraud Warnings. There is no
 * API toggle to repair this; the remediation is printed instead.
 */
const API = 'https://api.stripe.com/v1';

export const WARN_RATE = 0.005;      // Visa VAMP non-compliant
export const EXCESSIVE_RATE = 0.0075; // industry and Stripe guidance
export const PROGRAM_RATE = 0.015;   // VAMP excessive, Mastercard ECM

export const VAMP_FLOOR = 5;   // disputes plus early fraud warnings
export const ECM_FLOOR = 100;  // disputes alone

/**
 * Return [disputeRate, vampRate], or [null, null] with no charges. Pure.
 */
export function rates(disputes, efws, charges) {
  if (!charges) return [null, null];
  return [disputes / charges, (disputes + efws) / charges];
}

/**
 * Classify a month of dispute activity. Pure. Returns [state, detail].
 */
export function assess(disputes, efws, charges,
                       warn = WARN_RATE, excessive = EXCESSIVE_RATE,
                       program = PROGRAM_RATE) {
  const [disputeRate, vampRate] = rates(disputes, efws, charges);
  if (disputeRate === null) {
    return ['no_volume',
      'no successful captured charges in the window; there is nothing to divide by'];
  }

  const events = disputes + efws;
  const pct = `disputes ${(disputeRate * 100).toFixed(3)}%, ` +
              `with EFW ${(vampRate * 100).toFixed(3)}%`;

  if (vampRate < warn) {
    return ['clear', `${pct}, both under the ${(warn * 100).toFixed(2)}% VAMP line`];
  }
  if (events < VAMP_FLOOR && disputes < ECM_FLOOR) {
    return ['below_floor',
      `${pct}, but only ${events} countable event(s). VAMP needs ${VAMP_FLOOR} ` +
      `and ECM needs ${ECM_FLOOR} disputes, so no programme applies yet.`];
  }
  if (disputeRate >= program || vampRate >= program) {
    return ['program',
      `${pct}. At or above ${(program * 100).toFixed(2)}% this is VAMP excessive ` +
      `territory, and Mastercard ECM once you pass ${ECM_FLOOR} disputes in a month.`];
  }
  if (disputeRate >= excessive || vampRate >= excessive) {
    return ['excessive',
      `${pct}. Above the ${(excessive * 100).toFixed(2)}% the industry treats as ` +
      `excessive; expect monitoring before it reaches ${(program * 100).toFixed(2)}%.`];
  }
  return ['watch',
    `${pct}. At or above the ${(warn * 100).toFixed(2)}% VAMP non-compliant line ` +
    `and below the ${(excessive * 100).toFixed(2)}% excessive line: the month to act in.`];
}

/** Unix bounds for a YYYY-MM string, or the previous calendar month. */
export function monthBounds(month) {
  let year;
  let mon;
  if (month) {
    [year, mon] = month.split('-').map(Number);
  } else {
    const now = new Date();
    year = now.getUTCMonth() > 0 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    mon = now.getUTCMonth() > 0 ? now.getUTCMonth() : 12;
  }
  const start = Date.UTC(year, mon - 1, 1) / 1000;
  const end = Date.UTC(mon === 12 ? year + 1 : year, mon === 12 ? 0 : mon, 1) / 1000;
  return [start, end, `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}`];
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

async function countObjects(key, path, start, end, cap, keep) {
  let total = 0;
  let scanned = 0;
  const params = { limit: 100, 'created[gte]': start, 'created[lt]': end };
  for (;;) {
    const page = await get(key, path, params);
    const data = page.data ?? [];
    for (const obj of data) {
      scanned += 1;
      if (!keep || keep(obj)) total += 1;
    }
    if (data.length === 0 || !page.has_more) return [total, false];
    if (scanned >= cap) return [total, true];
    params.starting_after = data[data.length - 1].id;
  }
}

export function succeededAndCaptured(charge) {
  return charge.status === 'succeeded' && charge.captured === true;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const monthArg = process.argv.includes('--month')
    ? process.argv[process.argv.indexOf('--month') + 1] : undefined;
  const maxCharges = process.argv.includes('--max-charges')
    ? Number(process.argv[process.argv.indexOf('--max-charges') + 1]) : 50000;

  const [start, end, label] = monthBounds(monthArg);
  console.log(`counting ${label}`);

  const [disputes] = await countObjects(key, '/disputes', start, end, 100000);
  const [efws] = await countObjects(key, '/radar/early_fraud_warnings', start, end, 100000);
  const [charges, truncated] = await countObjects(
    key, '/charges', start, end, maxCharges, succeededAndCaptured);

  if (truncated) {
    console.error(`stopped after ${maxCharges} charges, so the denominator is ` +
                  'short and the ratio would read high. Raise --max-charges or ' +
                  'narrow the window.');
    process.exitCode = 2;
    return;
  }

  const [state, detail] = assess(disputes, efws, charges);
  const line = `${state.padEnd(12)} ${disputes} dispute(s), ${efws} EFW(s), ` +
               `${charges} successful charge(s): ${detail}`;
  if (state === 'clear' || state === 'no_volume') {
    console.log(line);
    return;
  }

  console.warn(line);
  console.warn('  there is no API repair for a ratio: reduce the numerator.');
  console.warn('  block highest risk in Radar, request 3DS on elevated risk,');
  console.warn('  refund actionable early fraud warnings before they escalate,');
  console.warn('  set a recognisable statement descriptor, and make cancelling self-serve.');
  console.warn('  remediation guidance: https://docs.stripe.com/disputes/monitoring-programs');
  process.exitCode = state === 'below_floor' ? 0 : 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
