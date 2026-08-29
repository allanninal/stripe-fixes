/**
 * Report connected accounts whose payout schedule leaves money stranded.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Connected accounts, Balance and Payouts. The repair is printed,
 * never performed.
 */
const API = 'https://api.stripe.com/v1';

export const STALE_DAYS = 30;      // manual, holding money, no payout this recently
const SLOW_DELAY_DAYS = 14;        // well above any country minimum

/**
 * Sort one connected account by its payout schedule. Pure, so the boundary
 * between a deliberate manual schedule and stranded money can be tested.
 * `available` is the summed available balance in minor units, or null.
 * `lastPayoutAgeDays` is null when the account has never had a payout.
 * Returns [state, detail].
 */
export function classify(account, available, lastPayoutAgeDays) {
  const schedule = account.settings?.payouts?.schedule ?? {};
  const interval = schedule.interval ?? null;
  const delay = schedule.delay_days;
  const held = available ?? 0;

  if (!account.payouts_enabled) {
    return ['disabled',
      'payouts_enabled is false: the schedule is not what is stopping the ' +
      'money, so fix the requirements first'];
  }

  if (interval === 'manual') {
    if (held <= 0) {
      return ['manual',
        'manual schedule with nothing available: intentional or not, no money ' +
        'is stuck right now'];
    }
    if (lastPayoutAgeDays === null || lastPayoutAgeDays === undefined) {
      return ['stranded',
        `manual schedule, ${held} available and no payout has ever been ` +
        'created: nothing is going to move it'];
    }
    if (lastPayoutAgeDays >= STALE_DAYS) {
      return ['stranded',
        `manual schedule, ${held} available and the last payout was ` +
        `${lastPayoutAgeDays.toFixed(0)} days ago: whatever creates them has stopped`];
    }
    return ['manual',
      `manual schedule, ${held} available and a payout ` +
      `${lastPayoutAgeDays.toFixed(0)} days ago: a job is running`];
  }

  if (interval === null) {
    return ['unknown', 'no settings.payouts.schedule.interval on the account object'];
  }

  if (Number.isInteger(delay) && delay > SLOW_DELAY_DAYS) {
    return ['slow',
      `${interval} schedule with delay_days=${delay}: working as configured, ` +
      'and far enough out to produce the same complaint'];
  }

  return ['scheduled', `${interval} schedule, delay_days=${delay}`];
}

async function get(key, path, { account = null, params = {} } = {}) {
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
    const page = await get(key, '/accounts', { params });
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

async function strandedFacts(key, accountId) {
  const balance = await get(key, '/balance', { account: accountId });
  const available = (balance.available ?? []).reduce((n, b) => n + (b.amount ?? 0), 0);
  const payouts = await get(key, '/payouts', { account: accountId, params: { limit: 1 } });
  const data = payouts.data ?? [];
  const age = data.length && data[0].created
    ? (Date.now() / 1000 - data[0].created) / 86400 : null;
  return { available, age };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const counts = {};
  let scanned = 0;
  for await (const acct of accounts(key)) {
    scanned += 1;
    const schedule = acct.settings?.payouts?.schedule ?? {};

    let available = null;
    let age = null;
    if (schedule.interval === 'manual' && acct.payouts_enabled) {
      ({ available, age } = await strandedFacts(key, acct.id));
    }

    const [state, detail] = classify(acct, available, age);
    counts[state] = (counts[state] ?? 0) + 1;
    if (state === 'scheduled') continue;
    console.warn(`${acct.id ?? 'acct_?'}  ${state.padEnd(10)} ${detail}`);
  }

  const stranded = counts.stranded ?? 0;
  console.log(`${scanned} account(s): ${stranded} stranded, ` +
              `${counts.manual ?? 0} manual, ${counts.slow ?? 0} slow`);

  if (stranded) {
    console.warn('  repair, one of two, and pick deliberately:');
    console.warn(`  POST ${API}/accounts/{id}  settings[payouts][schedule][interval]=daily`);
    console.warn(`  or keep manual and write the job that creates POST ${API}/payouts`);
    console.warn('  note: the first automatic payout releases the whole ' +
                 'accumulated balance at once. Warn the seller.');
  }
  if (counts.slow) {
    console.warn('  repair: lower settings[payouts][schedule][delay_days] to the ' +
                 'country minimum if it was inflated by accident');
  }
  if (stranded) process.exitCode = 1;
}

// Only run when invoked directly, so importing this module in the test file does
// not run main(), fail on the missing key and fail the suite.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
