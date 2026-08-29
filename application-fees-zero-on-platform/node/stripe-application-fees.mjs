/**
 * Report destination charges that carry no application fee.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Charges, Application fees and Balance transactions. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const DAY = 86400;

/**
 * Sort a platform's fee collection over one window. Pure, so the states can be
 * tested without a network. Returns [state, detail].
 */
export function classify(feeCount, destTotal, destWithFee, destImplicit) {
  const counts = [feeCount, destTotal, destWithFee, destImplicit];
  if (counts.some((c) => !Number.isInteger(c) || c < 0)) {
    return ['unknown',
      `counts must be non-negative integers: ${JSON.stringify(counts)}`];
  }
  if (destWithFee + destImplicit > destTotal) {
    return ['unknown',
      `${destWithFee} charges with a fee and ${destImplicit} implicit against ` +
      `only ${destTotal} destination charges: the counts do not agree`];
  }

  if (destTotal === 0) {
    return ['idle',
      'no destination charges in the window, so there is nothing here that ' +
      'could carry an application fee'];
  }

  if (feeCount === 0 && destImplicit && !destWithFee) {
    return ['invisible',
      `${destImplicit} of ${destTotal} destination charge(s) keep money on the ` +
      'platform via transfer_data[amount] and no ApplicationFee object exists: ' +
      'the revenue is real but every fee report will read zero'];
  }

  if (feeCount === 0) {
    return ['zero',
      `${destTotal} destination charge(s), none with application_fee_amount: ` +
      'the full amount went to the connected account every time'];
  }

  const missing = destTotal - destWithFee - destImplicit;
  if (missing > 0) {
    return ['partial',
      `${missing} of ${destTotal} destination charge(s) carry no fee at all: ` +
      'one code path that creates charges is not passing application_fee_amount'];
  }

  if (destImplicit) {
    return ['mixed',
      `${destWithFee} charge(s) take the fee explicitly and ${destImplicit} take ` +
      'it implicitly through transfer_data[amount]: the implicit ones never ' +
      'appear in /v1/application_fees'];
  }

  return ['collecting',
    `${destTotal} destination charge(s), ${destWithFee} with application_fee_amount`];
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

export async function countPages(key, path, since, cap = 5000, onItem = null) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, path, params);
    const data = page.data ?? [];
    for (const item of data) {
      seen += 1;
      if (onItem) onItem(item);
    }
    if (data.length === 0 || !page.has_more || seen >= cap) return seen;
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

  const days = Number((process.env.WINDOW_DAYS || "dummy-window-days") ?? 30);
  const since = Math.floor(Date.now() / 1000) - days * DAY;

  const feeCount = await countPages(key, '/application_fees', since);

  const tally = { dest: 0, fee: 0, implicit: 0 };
  const destinations = new Set();

  await countPages(key, '/charges', since, 5000, (charge) => {
    const transfer = charge.transfer_data ?? {};
    const dest = transfer.destination;
    if (!dest) return;
    tally.dest += 1;
    destinations.add(typeof dest === 'string' ? dest : (dest.id ?? '?'));
    if (charge.application_fee_amount !== null
        && charge.application_fee_amount !== undefined) {
      tally.fee += 1;
    } else if (transfer.amount !== null && transfer.amount !== undefined
               && transfer.amount < (charge.amount ?? 0)) {
      tally.implicit += 1;
    }
  });

  const [state, detail] = classify(feeCount, tally.dest, tally.fee, tally.implicit);
  const line = `${state.padEnd(11)} ${detail}`;
  if (state === 'collecting' || state === 'idle') console.log(line);
  else console.warn(line);
  console.log(`${feeCount} application fee object(s) in the window`);

  // Fees that exist as objects but never as balance transactions were collected
  // and then refunded, which is a different problem from this one.
  const btPage = await get(key, '/balance_transactions',
    { limit: 100, type: 'application_fee', 'created[gte]': since });
  if (feeCount && (btPage.data ?? []).length === 0) {
    console.warn('fee objects exist but no application_fee balance transaction in ' +
                 'the window: the fees were taken and refunded back out');
  }

  if (['zero', 'invisible', 'partial', 'mixed'].includes(state)) {
    console.warn('  repair: pass application_fee_amount in minor units on every ' +
                 'call that creates a charge with transfer_data[destination], ' +
                 'including subscriptions and invoices.');
    console.warn(`  check first, on each destination: GET ${API}/accounts/{id} and ` +
                 'confirm capabilities.transfers is active, because a fee on an ' +
                 'account without it fails the whole charge.');
    console.warn(`  ${destinations.size} destination account(s) seen in this window`);
    process.exitCode = 1;
  } else if (state === 'unknown') {
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
