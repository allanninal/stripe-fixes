/**
 * Report connected accounts whose payout destination Stripe has stopped using.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access
 * to Connected accounts, Bank accounts, Payouts and Balance. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const DAY = 86400;

// Statuses where Stripe has stopped sending scheduled payouts to this
// destination. Same symptom, three different repairs.
const HALTED = {
  errored:
    'a payout to this destination failed. Editing the account or routing number ' +
    'on the existing object does not clear this: attach a NEW external account ' +
    'and set default_for_currency on it.',
  verification_failed:
    'the ownership details behind this destination could not be verified. Attach ' +
    'a new external account whose holder details match the account.',
  tokenized_account_number_deactivated:
    'the tokenized account number behind this destination was deactivated. ' +
    'Re-link the bank through Financial Connections to mint a new one.',
};

// Statuses where payouts can be sent. `new` means Stripe has had no reason to
// validate it yet, which is not a problem.
const HEALTHY = ['new', 'validated', 'verified'];

/**
 * Classify one external account. Pure. Returns [state, detail].
 * The evidence arguments may be null, meaning nobody looked: it is only fetched
 * for destinations that already look halted, and the classifier has to keep
 * "no money stranded" distinct from "not checked".
 */
export function verdict(external, lastPayoutCreated, availableAmount, now) {
  if (external === null || external === undefined) {
    return ['no-destination',
      'no external account attached at all: there is nothing for a payout to be ' +
      'sent to'];
  }

  const status = (external.status ?? '').toLowerCase();

  if (Object.prototype.hasOwnProperty.call(HALTED, status)) {
    const bits = [`status ${status}`, HALTED[status]];
    if (availableAmount) {
      bits.push(`${availableAmount} (minor units) sitting in the available balance`);
    }
    if (lastPayoutCreated !== null && lastPayoutCreated !== undefined) {
      bits.push(`last payout ${Math.floor((now - lastPayoutCreated) / DAY)} day(s) ago`);
    } else if (availableAmount !== null && availableAmount !== undefined) {
      bits.push('no payout has ever been attempted');
    }
    if (!external.default_for_currency) {
      bits.push(`not the default destination for ${external.currency ?? 'its currency'}, ` +
                'so cleanup rather than the cause');
    }
    return [availableAmount ? 'stranded' : 'halted', bits.join(' | ')];
  }

  if (HEALTHY.includes(status)) {
    return ['healthy', `status ${status}: payouts can be sent here`];
  }

  return ['unknown',
    `unrecognised status ${JSON.stringify(external.status)}: read it before ` +
    'assuming it is fine'];
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

async function evidence(key, accountId) {
  const balance = await get(key, '/balance', { account: accountId });
  const available = (balance.available ?? []).reduce((t, b) => t + (b.amount ?? 0), 0);
  const payouts = await get(key, '/payouts', { account: accountId, limit: 1 });
  const data = payouts.data ?? [];
  return [data.length ? data[0].created : null, available];
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const targets = [];
  for await (const acct of accounts(key)) targets.push(acct);

  const counts = new Map();
  let destinations = 0;

  for (const acct of targets) {
    const banks = (await get(key, `/accounts/${acct.id}/external_accounts`,
      { object: 'bank_account', limit: 100 })).data ?? [];

    if (banks.length === 0) {
      const [state, detail] = verdict(null, null, null, now);
      counts.set(state, (counts.get(state) ?? 0) + 1);
      console.warn(`${acct.id}  ${state.padEnd(14)} ${detail}`);
      continue;
    }

    for (const bank of banks) {
      destinations += 1;
      // The evidence costs two extra calls, so only spend them where the status
      // already says payouts have stopped.
      const halted = Object.prototype.hasOwnProperty.call(
        HALTED, (bank.status ?? '').toLowerCase());
      const [lastPayout, available] = halted
        ? await evidence(key, acct.id) : [null, null];
      const [state, detail] = verdict(bank, lastPayout, available, now);
      counts.set(state, (counts.get(state) ?? 0) + 1);
      if (state === 'healthy') continue;
      console.warn(`${acct.id} ${bank.id ?? 'ba_?'}  ${state.padEnd(14)} ${detail}`);
    }
  }

  const halted = counts.get('halted') ?? 0;
  const stranded = counts.get('stranded') ?? 0;
  console.log(`${targets.length} account(s), ${destinations} destination(s): ` +
    `${halted} halted, ${stranded} stranded`);

  if (halted || stranded) {
    console.warn('  repair: attach fresh details rather than editing the frozen ' +
                 'object, then make the new one default:');
    console.warn(`  POST ${API}/accounts/{id} with external_account={{BANK_TOKEN}}`);
    console.warn(`  POST ${API}/accounts/{id}/external_accounts/{ba_id} with ` +
                 'default_for_currency=true');
    console.warn('  check: a flat count of failed payouts is not recovery when the ' +
                 'destination is frozen, because nothing is being attempted');
  }
  if (counts.get('no-destination')) {
    console.warn(`  ${counts.get('no-destination')} account(s) have no bank account ` +
                 'attached at all');
  }
  if (halted || stranded || counts.get('no-destination') || counts.get('unknown')) {
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
