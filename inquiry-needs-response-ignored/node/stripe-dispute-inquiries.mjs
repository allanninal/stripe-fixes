/**
 * Report Stripe pre-dispute inquiries that nobody has answered.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Disputes. The response is printed, never submitted, because
 * dispute evidence can be sent exactly once per dispute.
 */
const API = 'https://api.stripe.com/v1';

export const CRITICAL_HOURS = 72;

const INQUIRY_OPEN = ['warning_needs_response'];
const INQUIRY_ANSWERED = ['warning_under_review'];
const INQUIRY_CLOSED = ['warning_closed'];
const CHARGEBACK = ['needs_response', 'under_review', 'won', 'lost'];

/**
 * Which side of the escalation line a dispute status sits on. Pure.
 */
export function family(status) {
  if (INQUIRY_OPEN.includes(status) || INQUIRY_ANSWERED.includes(status)
      || INQUIRY_CLOSED.includes(status)) {
    return 'inquiry';
  }
  if (CHARGEBACK.includes(status)) return 'chargeback';
  return 'unknown';
}

/**
 * Classify one dispute. Pure, so the deadline arithmetic can be tested.
 * `now` is a unix timestamp in seconds.
 */
export function classify(dispute, now, criticalHours = CRITICAL_HOURS) {
  const status = dispute.status;
  const side = family(status);

  if (side === 'unknown') {
    return ['unknown', `unrecognised status ${JSON.stringify(status)}`];
  }
  if (side === 'chargeback') {
    return ['escalated',
      `already a chargeback (${status}). The funds and the dispute fee are gone ` +
      'and it counts toward the network ratio either way.'];
  }
  if (INQUIRY_CLOSED.includes(status)) {
    return ['closed', 'inquiry closed without escalating'];
  }
  if (INQUIRY_ANSWERED.includes(status)) {
    return ['answered', 'evidence is in and the issuer is reviewing it'];
  }

  const ed = dispute.evidence_details ?? {};
  const dueBy = ed.due_by;
  const staged = Boolean(ed.has_evidence);
  const sent = ed.submission_count ?? 0;

  if (sent) return ['answered', `${sent} submission(s) already sent`];
  if (staged) {
    return ['staged',
      'evidence is staged but submission_count is 0. Nothing has reached the ' +
      'issuer, and doing nothing is not the same as accepting: only evidence ' +
      'closes an inquiry.'];
  }
  if (dueBy === undefined || dueBy === null) {
    return ['unanswered', 'open inquiry with no due_by to measure against'];
  }

  const hours = (dueBy - now) / 3600;
  if (hours <= 0) {
    return ['lapsing',
      'past due_by while unanswered. Expect this to escalate into a formal ' +
      'chargeback, with the fee and the ratio entry attached.'];
  }
  if (hours <= criticalHours) {
    return ['critical', `${hours.toFixed(1)} hour(s) left and nothing attached.`];
  }
  return ['unanswered',
    `${(hours / 24).toFixed(1)} day(s) left to answer before escalation`];
}

/**
 * Amount at stake, in minor units. Not divided by 100, which is wrong for
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
  const counts = { inquiry: 0, chargeback: 0, unknown: 0 };
  const rows = [];

  for await (const d of disputes(key)) {
    counts[family(d.status)] += 1;
    const [state, detail] = classify(d, now);
    if (['unanswered', 'critical', 'staged', 'lapsing'].includes(state)) {
      rows.push([(d.evidence_details ?? {}).due_by ?? 0, d, state, detail]);
    }
  }

  rows.sort((a, b) => a[0] - b[0]);
  for (const [, d, state, detail] of rows) {
    console.warn(`${state.padEnd(10)} ${d.id ?? '?'}  ${money(d)}  ${detail}`);
    console.warn(`  repair: POST ${API}/disputes/${d.id} ` +
                 `-d 'evidence[uncategorized_text]=...' ` +
                 `-d 'evidence[product_description]=...' ` +
                 `-d 'evidence[shipping_tracking_number]=...'`);
    console.warn('  evidence submits once per dispute, so assemble it all first');
  }

  const total = counts.inquiry + counts.chargeback + counts.unknown;
  console.log(`${total} dispute(s) read: ${counts.inquiry} inquiry, ` +
              `${counts.chargeback} chargeback, ${rows.length} inquiry needing a response`);
  if (counts.inquiry && counts.chargeback > counts.inquiry) {
    console.log('more chargebacks than inquiries in this window: check that ' +
                'charge.dispute.created is routed on statuses starting warning_');
  }
  process.exitCode = rows.length ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
