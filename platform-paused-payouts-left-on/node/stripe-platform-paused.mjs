/**
 * Report connected accounts the platform paused and never unpaused.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access
 * to Connected accounts and Payouts. The repair is printed, never performed, and
 * it is printed as a Dashboard path because Stripe has no v1 endpoint that
 * unpauses an account.
 */
const API = 'https://api.stripe.com/v1';

const DAY = 86400;

const PAUSED = 'platform_paused';

/**
 * Classify one connected account against a platform pause. Pure.
 * Returns [state, detail]. Accounts disabled for any other reason come back as
 * `other-reason` rather than being folded in: blurring the two sends onboarding
 * links to sellers who have nothing to submit.
 */
export function verdict(account, canceledCount, oldestCanceledCreated, now) {
  const reqs = account.requirements ?? {};
  const reason = reqs.disabled_reason ?? null;

  if (reason === PAUSED) {
    const off = [];
    if (account.charges_enabled === false) off.push('charges');
    if (account.payouts_enabled === false) off.push('payouts');
    const bits = [`paused by the platform: ${off.join(' and ') || 'nothing'} off`];
    if (canceledCount) bits.push(`${canceledCount} canceled payout(s)`);
    if (oldestCanceledCreated !== null && oldestCanceledCreated !== undefined) {
      bits.push('paused for at least ' +
        `${Math.floor((now - oldestCanceledCreated) / DAY)} day(s), from the ` +
        'oldest cancellation');
    }
    bits.push('no API call reverses this: Dashboard, Connect, Connected accounts, ' +
              'open the account');
    return ['paused', bits.join(' | ')];
  }

  if (reason) {
    return ['other-reason',
      `disabled for ${reason}, which is not a platform pause and is not this ` +
      "check's problem"];
  }

  if (canceledCount) {
    return ['residue',
      `${canceledCount} canceled payout(s) on an account that is not paused now: a ` +
      'pause was lifted and the canceled payouts were never re-issued'];
  }

  return ['healthy', 'not paused'];
}

async function get(key, path, { account, ...params } = {}) {
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

export async function* accounts(key, cap = 5000) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/accounts', params);
    const data = page.data ?? [];
    for (const acct of data) {
      yield acct;
      seen += 1;
      if (seen >= cap) return;
    }
    if (data.length === 0 || !page.has_more) return;
    params.starting_after = data[data.length - 1].id;
  }
}

/**
 * Count canceled payouts for one account and find the oldest. A pause holds
 * in-flight payouts as pending for up to ten days and then cancels them, so this
 * is the paper trail. Failed payouts are a different problem and are not counted.
 */
async function canceledPayouts(key, accountId) {
  let count = 0;
  let oldest = null;
  const params = { status: 'canceled', limit: 100, account: accountId };
  for (;;) {
    const page = await get(key, '/payouts', params);
    const data = page.data ?? [];
    for (const payout of data) {
      count += 1;
      if (payout.created !== undefined && (oldest === null || payout.created < oldest)) {
        oldest = payout.created;
      }
    }
    if (data.length === 0 || !page.has_more) return [count, oldest];
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

  const everywhere = process.argv.includes('--check-canceled-everywhere');
  const now = Math.floor(Date.now() / 1000);
  const counts = new Map();
  let scanned = 0;

  for await (const acct of accounts(key)) {
    scanned += 1;
    const paused = (acct.requirements ?? {}).disabled_reason === PAUSED;
    const [count, oldest] = (paused || everywhere)
      ? await canceledPayouts(key, acct.id) : [0, null];

    const [state, detail] = verdict(acct, count, oldest, now);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'healthy' || state === 'other-reason') continue;
    console.warn(`${acct.id ?? 'acct_?'}  ${state.padEnd(8)} ${detail}`);
  }

  const paused = counts.get('paused') ?? 0;
  const residue = counts.get('residue') ?? 0;
  console.log(`${scanned} account(s): ${paused} paused by the platform, ` +
    `${residue} with canceled payouts to re-issue`);

  if (paused) {
    console.warn('  repair: Dashboard, Connect, Connected accounts, open the account, ' +
                 'unpause payments or payouts. There is no v1 API for it.');
    console.warn('  then: re-read the account and confirm payouts_enabled is true and ' +
                 'disabled_reason is gone');
    console.warn('  reconcile: every paused account should map to an OPEN ' +
                 'investigation. The ones that do not are the finding.');
  }
  if (paused || residue) {
    console.warn('  note: unpausing does not replay canceled payouts. The balance ' +
                 'waits for the next scheduled payout, or forever on a manual schedule.');
    process.exitCode = 1;
  }
  if (!everywhere) {
    console.log('  canceled payouts were only checked on paused accounts; ' +
                '--check-canceled-everywhere widens it');
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
