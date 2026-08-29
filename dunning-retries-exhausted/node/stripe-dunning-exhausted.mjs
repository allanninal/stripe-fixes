/**
 * Report Stripe invoices where dunning has stopped and no attempt is scheduled.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// The default Smart Retries schedule is eight attempts over two weeks. Four is a
// deliberately conservative floor: past it, a sequence that has stopped has
// stopped for a reason rather than by coincidence.
export const EXHAUSTED_ATTEMPTS = 4;

/**
 * Classify one automatically collected invoice. Pure, so the rules can be tested.
 * `nextAttemptInDays` is null when next_payment_attempt is null, which is Stripe
 * saying it will not try again.
 */
export function verdict(attemptCount, nextAttemptInDays, amountRemaining) {
  if (!amountRemaining || amountRemaining <= 0) {
    return ['nothing_due', 'open with amount_remaining 0: no money outstanding'];
  }
  if (nextAttemptInDays === null || nextAttemptInDays === undefined) {
    if (attemptCount >= EXHAUSTED_ATTEMPTS) {
      return ['exhausted',
        `${attemptCount} attempt(s) and next_payment_attempt is null: dunning is ` +
        'over and nothing will collect this'];
    }
    if (attemptCount) {
      return ['stopped_early',
        `only ${attemptCount} attempt(s) and nothing scheduled: Smart Retries is ` +
        'off, or an end-of-dunning action already ran'];
    }
    return ['never_attempted',
      '0 attempts and nothing scheduled: this invoice was never charged at all, ' +
      'which is an integration problem rather than a decline'];
  }
  if (attemptCount >= EXHAUSTED_ATTEMPTS) {
    return ['stalled',
      `${attemptCount} attempt(s) with another in ${nextAttemptInDays.toFixed(1)} ` +
      'day(s): on a hard decline the count keeps rising but nothing collects ' +
      'until a new payment method is attached'];
  }
  return ['retrying',
    `${attemptCount} attempt(s), next in ${nextAttemptInDays.toFixed(1)} day(s): ` +
    'dunning is still running'];
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

export async function openInvoices(key, limit = 2000) {
  const out = [];
  const params = { status: 'open', collection_method: 'charge_automatically', limit: 100 };
  for (;;) {
    const page = await get(key, '/invoices', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) break;
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

  const now = Date.now() / 1000;
  const rows = (await openInvoices(key)).map((inv) => {
    const nxt = inv.next_payment_attempt;
    const remaining = inv.amount_remaining ?? 0;
    return {
      id: inv.id ?? '<no id>',
      sub: inv.subscription ?? '<no subscription>',
      amount: remaining,
      currency: (inv.currency ?? '').toUpperCase(),
      state: verdict(inv.attempt_count ?? 0,
        nxt === null || nxt === undefined ? null : (nxt - now) / 86400,
        remaining),
    };
  });

  const stopped = rows.filter((r) => ['exhausted', 'stopped_early', 'never_attempted', 'stalled']
    .includes(r.state[0]));
  if (stopped.length === 0) {
    console.log(`${'clear'.padEnd(15)} 0 invoice(s) with dunning stopped`);
    return;
  }

  stopped.sort((a, b) => b.amount - a.amount);
  const lost = stopped.reduce((a, r) => a + r.amount, 0);
  console.warn(`${'stopped'.padEnd(15)} ${stopped.length} invoice(s) nothing is collecting, worth ${lost} in minor units`);
  for (const r of stopped.slice(0, 20)) {
    const [state, detail] = r.state;
    console.warn(`  ${state.padEnd(15)} ${r.id}  ${r.amount} ${r.currency}  ${detail}`);
    if (state === 'exhausted' || state === 'stalled') {
      console.warn('      collect a card, then set it on the subscription before ' +
                   `paying: POST ${API}/subscriptions/${r.sub} default_payment_method=<pm>`);
      console.warn(`      then POST ${API}/invoices/${r.id}/pay`);
    }
  }
  if (stopped.length > 20) console.warn(`  ... and ${stopped.length - 20} more`);
  console.warn('  check the schedule itself: Dashboard, Billing, Revenue recovery, ' +
               'Retries, and set an end-of-dunning action');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
