/**
 * Report Stripe bank-debit PaymentIntents stuck in processing past settlement.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to PaymentIntents. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Calendar days, generous on purpose: the documented settlement times are in
// business days (ACH about four, SEPA about five), so these carry a weekend.
// One number for every method would flag healthy SEPA while missing stuck ACH.
const SETTLEMENT_DAYS = {
  us_bank_account: 6,
  acss_debit: 6,
  sepa_debit: 7,
  bacs_debit: 5,
  au_becs_debit: 5,
};

/**
 * Sort one processing PaymentIntent against its own settlement window. Pure,
 * and `now` is passed in rather than read. Where an intent lists several debit
 * types the most generous window wins. Returns [state, detail].
 */
export function classify(intent, now, graceDays = 0) {
  if (intent.status !== 'processing') return ['not_processing', `status ${intent.status}`];

  const types = (intent.payment_method_types ?? []).filter((t) => t in SETTLEMENT_DAYS);
  const ageDays = (Number(now) - Number(intent.created ?? now)) / 86400;

  if (types.length === 0) {
    if (ageDays < 1) {
      return ['settling', 'processing on a synchronous method, less than a day old'];
    }
    return ['non_debit',
      `processing for ${ageDays.toFixed(1)} day(s) on a method with no ` +
      'multi-day settlement: the confirmation never completed'];
  }

  const window = Math.max(...types.map((t) => SETTLEMENT_DAYS[t])) + graceDays;
  const method = types.reduce(
    (a, b) => (SETTLEMENT_DAYS[b] > SETTLEMENT_DAYS[a] ? b : a));

  if (ageDays <= window) {
    return ['settling', `day ${ageDays.toFixed(1)} of a ${window} day window for ${method}`];
  }
  if (ageDays > 30) {
    return ['long_stuck',
      `${ageDays.toFixed(1)} day(s) in processing on ${method}: far past ` +
      'settlement, and past the window in which cancelling is still permitted'];
  }
  return ['stuck',
    `${ageDays.toFixed(1)} day(s) in processing on ${method}, window is ` +
    `${window}: this is not settlement taking its time`];
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

export async function* intents(key, since, cap = 20000) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/payment_intents', params);
    const data = page.data ?? [];
    for (const pi of data) {
      yield pi;
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

  const now = Math.floor(Date.now() / 1000);
  const days = Number((process.env.DAYS || "dummy-days") ?? 90);
  const graceDays = Number((process.env.GRACE_DAYS || "dummy-grace-days") ?? 0);

  const counts = {};
  const amounts = {};
  let processing = 0;

  for await (const pi of intents(key, now - days * 86400)) {
    const [state, detail] = classify(pi, now, graceDays);
    if (state === 'not_processing') continue;
    processing += 1;
    counts[state] = (counts[state] ?? 0) + 1;
    amounts[state] = (amounts[state] ?? 0) + (pi.amount ?? 0);
    if (state !== 'settling') {
      console.warn(`${pi.id ?? 'pi_?'}  ${state.padEnd(11)} ${detail}`);
    }
  }

  const stuck = counts.stuck ?? 0;
  const longStuck = counts.long_stuck ?? 0;

  console.log(`${processing} processing intent(s): ${counts.settling ?? 0} ` +
              `settling, ${stuck} stuck, ${longStuck} long-stuck, ` +
              `${counts.non_debit ?? 0} non-debit`);

  if (stuck || longStuck) {
    console.warn(`  ${(amounts.stuck ?? 0) + (amounts.long_stuck ?? 0)} minor ` +
                 'unit(s) sitting in processing past settlement');
    console.warn('  repair: subscribe an endpoint to payment_intent.succeeded, ' +
                 'payment_intent.processing and payment_intent.payment_failed, ' +
                 'and gate fulfilment on succeeded only:');
    console.warn(`  POST ${API}/webhook_endpoints -d url=... ` +
                 '-d enabled_events[]=payment_intent.succeeded');
  }
  if (longStuck) {
    console.warn(`  ${longStuck} intent(s) are past the point where cancelling ` +
                 `is permitted. Reconcile those against GET ${API}/charges.`);
  }
  if (counts.non_debit) {
    console.warn(`  ${counts.non_debit} intent(s) are processing on a method ` +
                 'with no multi-day settlement: those are a confirmation that ' +
                 'never finished, not a slow bank.');
  }
  if (stuck || longStuck || counts.non_debit) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
