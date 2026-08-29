/**
 * Report connected accounts with no external account able to settle their balance.
 *
 * Read only. Three kinds of GET and no writes: give this a RESTRICTED key with
 * read access to Connected accounts and External accounts. The repair is printed,
 * never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one account's settlement path. Pure, so the order of the checks is
 * testable. `spec` is the platform's country spec, or null to skip the corridor.
 */
export function verdict(account, externalAccounts, spec = null) {
  const country = account.country;
  const currency = (account.default_currency ?? '').toLowerCase();
  const accounts = externalAccounts ?? [];

  if (!currency) return ['unknown', 'the account has no default_currency to settle in'];

  if (spec) {
    const transferable = spec.supported_transfer_countries;
    if (transferable && !transferable.includes(country)) {
      return ['unsupported-corridor',
        `${country} is not in this platform's supported_transfer_countries; no bank ` +
        'account of any currency makes this payout legal'];
    }
    const bankable = spec.supported_bank_account_currencies;
    if (bankable && !(bankable[currency] ?? []).includes(country)) {
      return ['unbankable-currency',
        `a bank account in ${country} cannot hold ${currency.toUpperCase()} under ` +
        'this country spec'];
    }
  }

  if (accounts.length === 0) {
    return ['no-destination', 'no external account at all, so no payout is ever attempted'];
  }

  const matching = accounts.filter(
    (e) => (e.currency ?? '').toLowerCase() === currency);
  if (matching.length === 0) {
    const held = [...new Set(accounts.map((e) => (e.currency ?? '?').toUpperCase()))].sort();
    return ['currency-missing',
      `settles in ${currency.toUpperCase()} but the only destination(s) are ` +
      held.join(', ')];
  }
  if (!matching.some((e) => e.default_for_currency)) {
    return ['not-default',
      `a ${currency.toUpperCase()} destination exists but none is ` +
      'default_for_currency, so automatic payouts have no target'];
  }
  return ['settles',
    `${currency.toUpperCase()} destination present and default_for_currency`];
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

async function* paginate(key, path, limit) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, path, params);
    const data = page.data ?? [];
    for (const obj of data) {
      yield obj;
      if (++seen >= limit) return;
    }
    if (!page.has_more || data.length === 0) return;
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

  let spec = null;
  if (!process.argv.includes('--skip-country-spec')) {
    const platform = await get(key, '/account');
    spec = await get(key, `/country_specs/${platform.country ?? 'US'}`);
    console.log(`platform in ${platform.country}, ` +
                `${(spec.supported_transfer_countries ?? []).length} transfer ` +
                'country/countries supported');
  }

  let total = 0, settling = 0, blocked = 0;
  for await (const acct of paginate(key, '/accounts', 500)) {
    total += 1;
    const { data: externals = [] } =
      await get(key, `/accounts/${acct.id}/external_accounts`, { limit: 100 });
    const [state, detail] = verdict(acct, externals, spec);
    if (state === 'settles') { settling += 1; continue; }
    blocked += 1;
    console.warn(`${state.padEnd(21)} ${acct.id}  ${detail}`);
    if (state === 'not-default') {
      console.warn(`  repair: POST ${API}/accounts/${acct.id}/external_accounts/` +
                   '{ba_id} with default_for_currency=true');
    } else if (['currency-missing', 'no-destination', 'unbankable-currency'].includes(state)) {
      console.warn(`  repair: POST ${API}/accounts/${acct.id} with an ` +
                   `external_account token in ` +
                   `${(acct.default_currency ?? '?').toUpperCase()}, then flag it ` +
                   'default_for_currency=true');
    } else if (state === 'unsupported-corridor') {
      console.warn('  repair: none by API. Move this recipient to Global Payouts or ' +
                   'a locally acquiring platform account.');
    }
  }

  console.log(`${total} account(s): ${settling} settling, ${blocked} blocked`);
  process.exitCode = blocked ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
