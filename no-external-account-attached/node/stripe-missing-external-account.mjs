/**
 * Find connected accounts whose balance cannot move because nothing is attached.
 *
 * Read only. Two GETs per account and no writes: give this a RESTRICTED key with
 * read access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// A destination in one of these states is attached but cannot be paid to. It is a
// different problem from having none, and it needs fresh details rather than a
// form the seller has already filled in.
const UNUSABLE = ['errored', 'verification_failed',
  'tokenized_account_number_deactivated'];

/**
 * Decide whether this account can be paid out. Pure, so it can be tested.
 * `externalAccounts` is the data array from /v1/accounts/{id}/external_accounts.
 * Returns [state, detail].
 */
export function classify(externalAccounts, defaultCurrency, currentlyDue = []) {
  const rows = externalAccounts ?? [];
  const due = (currentlyDue ?? []).filter(Boolean);
  const asked = due.includes('external_account');
  const currency = (defaultCurrency ?? '').toLowerCase();

  if (rows.length === 0) {
    if (asked) {
      return ['none',
        'no external account, and external_account is in currently_due: Stripe is ' +
        'asking and nobody is collecting it'];
    }
    return ['none-unrequested',
      'no external account and Stripe is not asking for one: external account ' +
      'collection was turned off during onboarding'];
  }

  const unusable = rows.filter((r) => UNUSABLE.includes(r.status));
  const matching = rows.filter((r) => (r.currency ?? '').toLowerCase() === currency);
  const def = matching.filter((r) => r.default_for_currency);

  if (def.length) {
    const bad = def.filter((r) => UNUSABLE.includes(r.status));
    if (bad.length) {
      return ['unusable',
        `the default destination for ${currency || '?'} has status ${bad[0].status}: ` +
        'scheduled payouts to it have stopped'];
    }
    return ['attached', `${rows.length} destination(s), default set for ${currency || '?'}`];
  }

  if (matching.length) {
    return ['no-default',
      `${matching.length} destination(s) in ${currency || '?'} but none marked ` +
      'default_for_currency: payouts have nowhere to go'];
  }

  if (unusable.length) {
    return ['unusable',
      `${rows.length} destination(s), all in a failed state (${unusable[0].status})`];
  }

  return ['wrong-currency',
    `${rows.length} destination(s), none of them in ` +
    `${currency || 'the account default currency'}, so the balance cannot be paid out`];
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

export async function* accounts(key, cap = 1000) {
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

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const counts = new Map();
  let scanned = 0;

  for await (const acct of accounts(key)) {
    scanned += 1;
    const id = acct.id ?? 'acct_?';
    const page = await get(key, `/accounts/${id}/external_accounts`, { limit: 100 });
    const [state, detail] = classify(page.data, acct.default_currency,
      acct.requirements?.currently_due);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'attached') continue;
    console.warn(`${id}  ${state.padEnd(17)} ` +
                 `payouts_enabled=${acct.payouts_enabled}  ${detail}`);
  }

  const missing = (counts.get('none') ?? 0) + (counts.get('none-unrequested') ?? 0);
  const noDefault = (counts.get('no-default') ?? 0) + (counts.get('wrong-currency') ?? 0);

  console.log(`${scanned} account(s): ${missing} with no destination, ${noDefault} ` +
              'with no default for their currency');

  if (counts.get('none')) {
    console.warn('  repair: send the seller an account link of type account_update ' +
                 'so they attach a bank account themselves');
  }
  if (counts.get('none-unrequested')) {
    console.warn('  repair: Dashboard, Settings, Connect, Payouts: re-enable external ' +
                 'account collection, or finish the flow that was going to collect it ' +
                 'in your own interface');
  }
  if (noDefault) {
    console.warn('  repair: mark one destination default_for_currency for the account ' +
                 'default_currency, or attach one in that currency');
  }
  if (counts.get('unusable')) {
    console.warn('  repair: attach fresh details. Editing the numbers on an errored ' +
                 'destination does not clear the status.');
  }
  if (missing || noDefault || counts.get('unusable')) {
    console.warn('  check: the balance on these accounts says how old this is:');
    console.warn(`  GET ${API}/balance  with the Stripe-Account header`);
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
