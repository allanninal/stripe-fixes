/**
 * Report Stripe balance currencies that no payout can drain.
 *
 * Read only. Three GETs and no writes: give this a RESTRICTED key with read
 * access to Balance, Connected accounts and Payouts. The repair is printed,
 * never performed.
 */
const API = 'https://api.stripe.com/v1';
const DAY = 86400;

/**
 * Sort one currency of a Stripe balance. Pure, so the states can be tested
 * without a network. Returns [state, detail].
 */
export function classify(entry, pending, hasDestination, payoutsSeen) {
  const amount = entry.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return ['unknown',
      `available entry has no numeric amount: ${JSON.stringify(amount)}`];
  }

  if (!hasDestination) {
    if (amount > 0) {
      return ['stranded',
        `${amount} settled with no external account in this currency: no ` +
        'automatic payout can target it, so it will sit here indefinitely'];
    }
    if (pending > 0) {
      return ['accruing',
        `${pending} still pending with no external account in this currency: ` +
        'it becomes stranded when it settles'];
    }
    return ['clear', 'no destination for this currency, but nothing is in it'];
  }

  if (amount > 0 && !payoutsSeen) {
    return ['stalled',
      `${amount} settled and a destination exists, but no payout in this ` +
      'currency in the window: the external account is probably not ' +
      'default_for_currency'];
  }

  if (amount > 0 || pending > 0) {
    return ['draining', `destination present, ${payoutsSeen} payout(s) in the window`];
  }

  return ['clear', 'empty bucket'];
}

async function get(key, path, params = {}, headers = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, ...headers },
  });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export async function payoutCurrencies(key, headers, since) {
  const counts = new Map();
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/payouts', params, headers);
    const data = page.data ?? [];
    for (const p of data) {
      const cur = p.currency ?? '?';
      counts.set(cur, (counts.get(cur) ?? 0) + 1);
    }
    if (data.length === 0 || !page.has_more) return counts;
    params.starting_after = data[data.length - 1].id;
  }
}

export async function destinationCurrencies(key, headers, accountId) {
  const out = new Set();
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, `/accounts/${accountId}/external_accounts`,
                           params, headers);
    const data = page.data ?? [];
    for (const ext of data) if (ext.currency) out.add(ext.currency);
    if (data.length === 0 || !page.has_more) return out;
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

  const account = (process.env.STRIPE_ACCOUNT || "dummy-stripe-account") ?? null;
  const headers = account ? { 'Stripe-Account': account } : {};
  const since = Math.floor(Date.now() / 1000) - 90 * DAY;

  const accountId = account ?? (await get(key, '/account')).id;
  const balance = await get(key, '/balance', {}, headers);
  const destinations = await destinationCurrencies(key, headers, accountId);
  const payouts = await payoutCurrencies(key, headers, since);

  const pending = new Map((balance.pending ?? [])
    .map((e) => [e.currency ?? '?', e.amount ?? 0]));
  const available = balance.available ?? [];
  const currencies = new Set([
    ...available.map((e) => e.currency ?? '?'), ...pending.keys(),
  ]);

  const counts = {};
  for (const cur of [...currencies].sort()) {
    const entry = available.find((e) => e.currency === cur)
      ?? { currency: cur, amount: 0 };
    const [state, detail] = classify(entry, pending.get(cur) ?? 0,
                                     destinations.has(cur), payouts.get(cur) ?? 0);
    counts[state] = (counts[state] ?? 0) + 1;
    const line = `${cur.padEnd(4)} ${state.padEnd(10)} ${detail}`;
    if (state === 'clear' || state === 'draining') console.log(line);
    else console.warn(line);
  }

  const stranded = counts.stranded ?? 0;
  const accruing = counts.accruing ?? 0;
  const stalled = counts.stalled ?? 0;
  console.log(`${currencies.size} bucket(s): ${stranded} stranded, ` +
              `${accruing} accruing, ${stalled} stalled`);

  if (stranded || accruing) {
    console.warn('  repair: add a destination in that currency and make it the ' +
                 'default, or stop accepting the currency:');
    console.warn(`  POST ${API}/accounts/${accountId} with external_account in ` +
                 'the currency, then default_for_currency=true');
  }
  if (stalled) {
    console.warn('  repair: a destination exists but is not being used. Check ' +
                 'default_for_currency on it before adding another one.');
  }
  if (stranded || accruing || stalled || counts.unknown) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
