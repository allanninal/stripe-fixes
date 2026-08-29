/**
 * Report Stripe disputes whose response deadline is about to pass.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Disputes. The response is printed, never submitted, because
 * dispute evidence can be sent exactly once.
 */
const API = 'https://api.stripe.com/v1';

export const CRITICAL_HOURS = 72;

const OPEN = ['needs_response', 'warning_needs_response'];
const IN_REVIEW = ['under_review', 'warning_under_review'];
const SETTLED = ['won', 'lost', 'warning_closed'];

/**
 * Classify one dispute. Pure, so the deadline arithmetic can be tested.
 * `now` is a unix timestamp in seconds.
 */
export function verdict(dispute, now, criticalHours = CRITICAL_HOURS) {
  const status = dispute.status;
  const ed = dispute.evidence_details ?? {};

  if (IN_REVIEW.includes(status)) {
    return ['submitted', 'evidence is in and the network is reviewing it'];
  }
  if (SETTLED.includes(status)) {
    return ['closed', `closed as ${status}; there is nothing left to send`];
  }
  if (!OPEN.includes(status)) {
    return ['unknown', `unrecognised status ${JSON.stringify(status)}`];
  }

  const dueBy = ed.due_by;
  const staged = Boolean(ed.has_evidence);
  const sent = ed.submission_count ?? 0;

  if (ed.past_due || (dueBy !== undefined && dueBy !== null && dueBy <= now)) {
    return ['forfeited',
      'past due_by while still needing a response. The funds and the dispute ' +
      'fee are gone, and no evidence will be accepted now.'];
  }
  if (dueBy === undefined || dueBy === null) {
    return ['unknown', 'open, but with no due_by to measure against'];
  }

  const hours = (dueBy - now) / 3600;
  if (hours <= criticalHours) {
    if (staged && !sent) {
      return ['staged',
        `${hours.toFixed(1)} hour(s) left. Evidence is staged but ` +
        'submission_count is 0, so none of it has reached the network.'];
    }
    return ['critical', `${hours.toFixed(1)} hour(s) left and nothing attached.`];
  }
  if (staged && !sent) {
    return ['open', `${(hours / 24).toFixed(1)} day(s) left; evidence staged, not submitted`];
  }
  return ['open', `${(hours / 24).toFixed(1)} day(s) left to assemble evidence`];
}

/**
 * Amount at risk, in minor units. Not divided by 100, which is wrong for
 * zero-decimal currencies such as JPY.
 */
export function money(dispute) {
  return `${dispute.amount} ${(dispute.currency ?? '?').toUpperCase()}`;
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

export async function* disputes(key, limit = 1000) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/disputes', params);
    const data = page.data ?? [];
    for (const d of data) { yield d; seen += 1; }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const now = Date.now() / 1000;
  let seen = 0;
  let urgent = 0;

  for await (const d of disputes(key)) {
    seen += 1;
    const [state, detail] = verdict(d, now);
    if (state === 'submitted' || state === 'closed' || state === 'open') {
      console.log(`${state.padEnd(10)} ${d.id ?? '?'}  ${detail}`);
      continue;
    }

    urgent += 1;
    console.warn(`${state.padEnd(10)} ${d.id ?? '?'}  ${money(d)}  ${detail}`);
    if (state === 'unknown') continue;
    if (state === 'forfeited') {
      console.warn('  nothing to run: the window is closed. Count it with the ' +
                   'other forfeits and fix the sweep, not this dispute.');
      continue;
    }
    console.warn(`  repair: POST ${API}/disputes/${d.id} ` +
                 `-d 'evidence[product_description]=...' ` +
                 `-d 'evidence[shipping_tracking_number]=...' ` +
                 `-d 'evidence[customer_communication]=<file_id>'`);
    console.warn('  evidence submits once, so assemble it all first. ' +
                 `To concede on purpose: POST ${API}/disputes/${d.id}/close`);
    if ((d.enhanced_eligibility_types ?? []).includes('visa_compelling_evidence_3')) {
      console.warn('  eligible for Visa Compelling Evidence 3.0: Stripe ' +
                   'pre-populates most of this from prior transactions');
    }
  }

  console.log(`${seen} dispute(s) read, ${urgent} needing a response now`);
  process.exitCode = urgent ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
