/**
 * Report payouts that cannot be tied back to their balance transactions.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Payouts and Balance transactions. The repair is printed, never
 * performed.
 */
const API = 'https://api.stripe.com/v1';
const DAY = 86400;

/**
 * Sort one payout by whether its contents can be recovered. Pure, so the states
 * can be tested without a network. `txnSum` is null when the balance
 * transactions were not fetched. Returns [state, detail].
 */
export function classify(payout, txnSum, txnCount) {
  const status = payout.reconciliation_status;
  const automatic = payout.automatic;
  const amount = payout.amount;

  if (status === 'completed') {
    if (txnSum === null || txnSum === undefined) {
      return ['reconcilable',
        'reconciliation_status completed: the breakdown exists, this run did ' +
        'not fetch it'];
    }
    if (!Number.isInteger(amount)) {
      return ['unknown', `payout has no numeric amount: ${JSON.stringify(amount)}`];
    }
    if (txnSum !== amount) {
      return ['mismatch',
        `${txnCount} balance transaction(s) sum to ${txnSum} against a payout ` +
        `amount of ${amount}, ${Math.abs(amount - txnSum)} apart: look for ` +
        'another currency, a reversal in the window, or a page you stopped ' +
        'paginating'];
    }
    return ['reconciled', `${txnCount} balance transaction(s) sum to the payout`];
  }

  if (status === 'in_progress') {
    return ['pending',
      'reconciliation_status in_progress: Stripe is still assembling the ' +
      'breakdown, which fills in after the payout settles'];
  }

  if (status === 'not_applicable') {
    if (automatic === false) {
      return ['manual',
        'manual payout: reconciliation_status not_applicable, so no balance ' +
        'transaction will ever list against it. The itemized report is the only ' +
        'route to its contents'];
    }
    return ['unsupported',
      'reconciliation_status not_applicable on an automatic payout: Stripe ' +
      'itemises standard automatic payouts only'];
  }

  return ['unknown',
    `unrecognised reconciliation_status: ${JSON.stringify(status)}`];
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

export async function payoutTransactions(key, payoutId, cap = 10000) {
  let total = 0;
  let count = 0;
  const params = { payout: payoutId, limit: 100 };
  for (;;) {
    const page = await get(key, '/balance_transactions', params);
    const data = page.data ?? [];
    for (const bt of data) {
      total += bt.net ?? 0;
      count += 1;
    }
    if (data.length === 0 || !page.has_more || count >= cap) {
      return { total, count };
    }
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

  const days = Number((process.env.WINDOW_DAYS || "dummy-window-days") ?? 90);
  const since = Math.floor(Date.now() / 1000) - days * DAY;

  const counts = {};
  let scanned = 0;
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/payouts', params);
    const data = page.data ?? [];
    for (const payout of data) {
      scanned += 1;
      let txnSum = null;
      let txnCount = null;
      if (payout.reconciliation_status === 'completed') {
        const { total, count } = await payoutTransactions(key, payout.id);
        txnSum = total;
        txnCount = count;
      }
      const [state, detail] = classify(payout, txnSum, txnCount);
      counts[state] = (counts[state] ?? 0) + 1;
      const line = `${payout.id ?? 'po_?'}  ${state.padEnd(13)} ${detail}`;
      if (['reconciled', 'reconcilable', 'pending'].includes(state)) console.log(line);
      else console.warn(line);
    }
    if (data.length === 0 || !page.has_more) break;
    params.starting_after = data[data.length - 1].id;
  }

  const manual = counts.manual ?? 0;
  const mismatched = counts.mismatch ?? 0;
  const unsupported = counts.unsupported ?? 0;
  console.log(`${scanned} payout(s): ${manual} manual, ${mismatched} mismatched, ` +
              `${unsupported} unsupported`);

  if (manual || unsupported) {
    console.warn('  repair: move the account to an automatic schedule so future ' +
                 'payouts are itemised:');
    console.warn(`  POST ${API}/accounts/{id} with ` +
                 'settings[payouts][schedule][interval]=daily');
    console.warn(`  for history, run the itemized report: POST ` +
                 `${API}/reporting/report_runs with ` +
                 'report_type=payout_reconciliation.by_id.itemized.1');
  }
  if (mismatched) {
    console.warn('  repair: the breakdown exists but does not add up. Check for a ' +
                 'second currency and for transfers with amount_reversed > 0 in ' +
                 'the same window.');
  }
  if (manual || mismatched || unsupported || counts.unknown) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
