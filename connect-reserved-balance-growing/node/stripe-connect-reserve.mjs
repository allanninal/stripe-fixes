/**
 * Report platform funds held in connect_reserved against negative accounts.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Balance, Balance transactions and Connected accounts. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const DAY = 86400;

/**
 * Sort one currency bucket of connect_reserved. Pure, so the states can be
 * tested without a network. `reserved` and `collected` are magnitudes in minor
 * units, because the sign of a balance transaction depends on the direction of
 * the movement and only the size matters here. Returns [state, detail].
 */
export function classify(entry, reserved, collected) {
  const amount = entry.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return ['unknown',
      `connect_reserved entry has no numeric amount: ${JSON.stringify(amount)}`];
  }

  if (collected) {
    return ['written-off',
      `${collected} already moved out as connect_collection_transfer: accounts ` +
      'that stayed negative for 180 days were settled from your reserve, and ' +
      'that money is not coming back'];
  }

  if (amount > 0 && reserved) {
    return ['growing',
      `${amount} held now and ${reserved} of reserve_transaction activity in the ` +
      'window: accounts are still going negative faster than they earn back'];
  }

  if (amount > 0) {
    return ['held',
      `${amount} held with no reserve_transaction activity in the window: the ` +
      'negative account behind it has stopped trading, so nothing will release ' +
      'this before the 180 day settlement'];
  }

  if (reserved) {
    return ['settled',
      `nothing held now, ${reserved} of reserve_transaction activity in the ` +
      'window: reserves were taken and released as accounts earned back'];
  }

  return ['clear', 'nothing reserved'];
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

export async function totalsByCurrency(key, type, since, cap = 5000) {
  const totals = new Map();
  let seen = 0;
  const params = { type, limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/balance_transactions', params);
    const data = page.data ?? [];
    for (const bt of data) {
      const cur = bt.currency ?? '?';
      totals.set(cur, (totals.get(cur) ?? 0) + Math.abs(bt.amount ?? 0));
      seen += 1;
    }
    if (data.length === 0 || !page.has_more || seen >= cap) return totals;
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

  const balance = await get(key, '/balance');
  const reservedNow = balance.connect_reserved ?? [];
  if (reservedNow.length === 0) {
    console.log('no connect_reserved on this balance: either not a platform, or ' +
                'no account has ever gone negative');
  }

  const reserved = await totalsByCurrency(key, 'reserve_transaction', since);
  const collected = await totalsByCurrency(key, 'connect_collection_transfer', since);

  const currencies = new Set([
    ...reservedNow.map((e) => e.currency ?? '?'),
    ...reserved.keys(), ...collected.keys(),
  ]);

  const counts = {};
  for (const cur of [...currencies].sort()) {
    const entry = reservedNow.find((e) => e.currency === cur)
      ?? { currency: cur, amount: 0 };
    const [state, detail] = classify(entry, reserved.get(cur) ?? 0,
                                     collected.get(cur) ?? 0);
    counts[state] = (counts[state] ?? 0) + 1;
    const line = `${cur.padEnd(4)} ${state.padEnd(11)} ${detail}`;
    if (state === 'clear' || state === 'settled') console.log(line);
    else console.warn(line);
  }

  console.log(`${currencies.size} currency bucket(s): ${counts.growing ?? 0} ` +
              `growing, ${counts.held ?? 0} held, ` +
              `${counts['written-off'] ?? 0} written off`);

  if (counts.growing || counts.held || counts['written-off']) {
    console.warn('  repair, per negative account, in order of preference:');
    console.warn(`  1. transfer the shortfall to the account to release the ` +
                 `reserve now: ${API}/transfers with destination=acct_x`);
    console.warn(`  2. make future shortfalls come out of the account's own bank: ` +
                 `${API}/balance_settings with Stripe-Account, ` +
                 `payments[debit_negative_balances]=true`);
    console.warn(`  3. for accounts that will never trade again, reject them so ` +
                 `nothing more accrues: ${API}/accounts/{id}/reject`);
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
