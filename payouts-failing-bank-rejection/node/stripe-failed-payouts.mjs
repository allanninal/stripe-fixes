/**
 * Group failed Stripe payouts by failure_code and say what each one needs.
 *
 * Read only. One paginated GET per account and no writes: give this a RESTRICTED
 * key with read access to Payouts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// The destination is wrong or gone. Nothing but new bank details fixes these.
const NEW_DETAILS = [
  'account_closed', 'no_account', 'invalid_account_number',
  'invalid_account_number_length', 'incorrect_account_holder_name',
  'incorrect_account_holder_address', 'incorrect_account_holder_tax_id',
  'unsupported_card',
];
// The account exists but its holder has to authorise something with their bank.
const BANK_AUTHORISATION = [
  'debit_not_authorized', 'incorrect_account_type', 'declined',
  'bank_account_restricted', 'account_frozen',
];
// Your balance, not their bank.
const FUNDING = ['insufficient_funds'];
// Transient. Worth one retry before anyone is contacted.
const TRANSIENT = ['could_not_process', 'bank_ownership_changed'];
// A configuration mismatch on the destination rather than a bad number.
const CONFIGURATION = ['invalid_currency', 'unsupported_currency'];

/**
 * Sort one payout by what its failure needs. Pure, so the table is testable.
 * The states name the person who can act, which is the only grouping that
 * changes what you do next. Returns [state, detail].
 */
export function classify(payout) {
  const status = payout.status;
  if (['paid', 'in_transit', 'pending'].includes(status)) {
    return ['open', `status ${status}: not a failure, and not final either`];
  }
  if (status === 'canceled') {
    return ['canceled', 'cancelled before it left, nothing was rejected'];
  }
  if (status !== 'failed') {
    return ['unknown', `unrecognised status ${JSON.stringify(status)}`];
  }

  const code = payout.failure_code ?? 'unknown';
  const message = payout.failure_message ?? 'no failure_message';
  const returned = payout.failure_balance_transaction != null;
  const tail = returned ? '' : ' (no failure_balance_transaction: check the balance)';

  if (NEW_DETAILS.includes(code)) {
    return ['new-details',
      `${code}: the destination is gone or wrong. Attach a fresh external ` +
      `account; re-entering the same number fails identically.${tail}`];
  }
  if (BANK_AUTHORISATION.includes(code)) {
    return ['bank-authorisation',
      `${code}: the account exists, its holder has to settle this with their ` +
      `bank. New details will not help.${tail}`];
  }
  if (FUNDING.includes(code)) {
    return ['funding',
      `${code}: your balance could not cover it. This is your side, not theirs.${tail}`];
  }
  if (TRANSIENT.includes(code)) {
    return ['transient', `${code}: worth one retry before anyone is contacted.${tail}`];
  }
  if (CONFIGURATION.includes(code)) {
    return ['configuration',
      `${code}: the destination cannot receive this currency.${tail}`];
  }
  return ['unclassified', `failure_code ${code}: ${message}${tail}`];
}

async function get(key, path, { account = null, ...params } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Authorization: `Bearer ${key}` };
  if (account) headers['Stripe-Account'] = account;
  const res = await fetch(url, { headers });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export async function* failedPayouts(key, since, cap = 2000, account = null) {
  let seen = 0;
  const params = { account, limit: 100, status: 'failed', 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/payouts', params);
    const data = page.data ?? [];
    for (const po of data) {
      yield po;
      seen += 1;
      if (seen >= cap) return;
    }
    if (data.length === 0 || !page.has_more) return;
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

  const days = Number((process.env.DAYS || "dummy-days") ?? 90);
  const extra = ((process.env.ACCOUNTS || "dummy-accounts") ?? '').split(',').filter(Boolean);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const counts = new Map();
  const byCode = new Map();
  let returnedMinor = 0;
  let total = 0;

  for (const account of [null, ...extra]) {
    for await (const po of failedPayouts(key, since, 2000, account)) {
      total += 1;
      const [state, detail] = classify(po);
      counts.set(state, (counts.get(state) ?? 0) + 1);
      const code = po.failure_code ?? 'unknown';
      byCode.set(code, (byCode.get(code) ?? 0) + 1);
      returnedMinor += po.amount ?? 0;
      console.warn(`${po.id ?? 'po_?'}  ${state.padEnd(18)} ` +
                   `dest=${po.destination ?? '?'}  ${detail}`);
    }
  }

  console.log(`${total} failed payout(s) in the last ${days} days`);
  for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
    console.warn(`  ${code.padEnd(34)} ${n}`);
  }

  if (total) {
    console.warn(`  ${returnedMinor} in minor units came back to the balance: ` +
                 'reconcile against failure_balance_transaction or it is counted twice');
  }
  if (counts.get('new-details')) {
    console.warn('  repair: attach a new external account and make it the default ' +
                 'for the currency. Editing the existing one rarely clears it.');
  }
  if (counts.get('bank-authorisation')) {
    console.warn('  repair: the account holder authorises credits and debits with ' +
                 'their own bank. No API call substitutes for that.');
  }
  if (counts.get('funding')) {
    console.warn('  repair: fund the balance before the next payout cycle');
  }
  if (total) {
    console.warn('  check: the destination status is probably errored, which stops ' +
                 'scheduled payouts and is why the failures are not accumulating:');
    console.warn(`  GET ${API}/accounts/{id}/external_accounts`);
    console.warn('  check: payout.failed in enabled_events, or this stays a five ' +
                 'day old surprise:');
    console.warn(`  GET ${API}/webhook_endpoints`);
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
