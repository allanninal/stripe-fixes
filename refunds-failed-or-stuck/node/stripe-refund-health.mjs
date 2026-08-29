/**
 * Report Stripe refunds that failed, stalled, or are waiting on the customer.
 *
 * Read only. One paginated GET, no writes: give this a RESTRICTED key with read
 * access to Refunds. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const PENDING_SECONDS = 10 * 86400;

// Reasons where retrying the same card is pointless: the card is gone.
const DEAD_CARD = ['expired_or_canceled_card', 'lost_or_stolen_card'];

/**
 * Classify one refund. Pure, so the rules can be tested without a network.
 * `failed` and `requires_action` stay apart on purpose: the first is money you
 * still owe the customer, the second is an instruction you still owe them.
 */
export function classify(refund, now, pendingAfter = PENDING_SECONDS) {
  const status = refund.status;
  if (status === 'failed') {
    const reason = refund.failure_reason ?? 'unknown';
    if (DEAD_CARD.includes(reason)) {
      return ['failed',
        `${reason}: the card no longer exists, so a retry fails the same way. ` +
        'Refund out of band.'];
    }
    return ['failed', `${reason}: the money left your balance and reached nobody`];
  }
  if (status === 'requires_action') {
    return ['needs-action',
      'the customer has to follow refund.next_action before this completes'];
  }
  if (status === 'pending') {
    const created = refund.created;
    if (!Number.isInteger(created)) {
      return ['unknown', 'pending with no created timestamp, so it cannot be aged'];
    }
    const days = Math.floor((now - created) / 86400);
    if (now - created < pendingAfter) {
      return ['pending', `${days}d old, inside the normal settlement window`];
    }
    return ['stalled',
      `${days}d old and still pending (${refund.pending_reason ?? 'no pending_reason'})`];
  }
  if (status === 'succeeded' || status === 'canceled') {
    return ['settled', `status ${JSON.stringify(status)}`];
  }
  return ['unknown', `unrecognised status ${JSON.stringify(status)}`];
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

export async function* refunds(key, since, cap) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/refunds', params);
    const data = page.data ?? [];
    for (const rf of data) {
      yield rf;
      seen += 1;
      if (seen >= cap) return;
    }
    if (!page.has_more || data.length === 0) return;
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

  const days = Number((process.env.DAYS || "dummy-days") ?? 180);
  const pendingAfter = Number((process.env.PENDING_DAYS || "dummy-pending-days") ?? 10) * 86400;
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;

  const counts = new Map();
  const byReason = new Map();
  let lost = 0;
  let scanned = 0;

  for await (const rf of refunds(key, since, 5000)) {
    scanned += 1;
    const [state, detail] = classify(rf, now, pendingAfter);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (['failed', 'needs-action', 'stalled'].includes(state)) {
      console.warn(`${rf.id}  charge=${rf.charge ?? '?'}  ${detail}`);
    }
    if (state === 'failed') {
      lost += rf.amount ?? 0;
      const reason = rf.failure_reason ?? 'unknown';
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }

  const failed = counts.get('failed') ?? 0;
  const needs = counts.get('needs-action') ?? 0;
  const stalled = counts.get('stalled') ?? 0;

  console.log(`${scanned} refund(s): ${failed} failed, ${needs} needing action, ` +
              `${stalled} stalled pending`);

  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.warn(`  ${reason.padEnd(34)} ${n}`);
  }

  if (failed) {
    console.warn(`  ${lost} in minor units left your balance and reached nobody`);
    console.warn('  repair: subscribe to charge.refund.updated and open a support ' +
                 'ticket for every status == failed');
    console.warn('  repair: for a dead card, pay the customer out of band; ' +
                 'retrying the same refund fails identically');
    console.warn('  check: reconcile against failure_balance_transaction so the ' +
                 're-credit is not read as a second refund');
  }
  if (needs) {
    console.warn(`  repair: read GET ${API}/refunds/{id} and send the customer the ` +
                 'link in next_action');
  }
  if (stalled) {
    console.warn('  check: pending_reason says whether this is settlement, your ' +
                 'balance, or an unsettled original charge');
  }
  process.exitCode = (failed || needs || stalled) ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
