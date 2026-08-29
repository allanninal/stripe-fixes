/**
 * Report connected accounts that cannot take payments, and say who can fix each.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Reasons the API cannot clear. An onboarding link sent to one of these produces
// a completed form and no change in status.
const DASHBOARD_ONLY = ['listed', 'under_review', 'rejected'];

// Stripe is holding the account while it checks something. Nothing to collect.
const WAITING = ['requirements.pending_verification'];

/**
 * Sort one connected account. Pure, so the reason table can be tested.
 * Returns [state, detail]. The states split the work by who can do it.
 */
export function classify(account) {
  const reqs = account.requirements ?? {};
  const reason = reqs.disabled_reason ?? null;
  const due = (reqs.currently_due ?? []).filter(Boolean);

  if (account.charges_enabled) return ['live', 'charges_enabled, nothing to chase'];

  if (!account.details_submitted) {
    return ['never-onboarded',
      'details_submitted is false: this account never opened, so it has not ' +
      'broken. Do not page anyone about it.'];
  }

  if (reason && (DASHBOARD_ONLY.includes(reason) || reason.split('.')[0] === 'rejected')) {
    return ['rejected',
      `disabled_reason ${reason}: the API cannot clear this. It is resolved from ` +
      'the Dashboard Connected accounts page, or not at all.'];
  }

  if (reason && WAITING.includes(reason)) {
    return ['waiting',
      `disabled_reason ${reason}: Stripe is verifying what it already has. ` +
      'Collecting more fields does not speed it up.'];
  }

  if (due.length) {
    return ['blocked',
      `${reason ?? 'no disabled_reason'}, ${due.length} field(s) currently due: ` +
      due.slice(0, 4).join(', ')];
  }

  if (reason) {
    return ['blocked',
      `${reason} with nothing in currently_due: read the per-capability ` +
      'requirements before collecting anything.'];
  }

  return ['unknown',
    'charges_enabled is false with no disabled_reason and no currently_due'];
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
    const [state, detail] = classify(acct);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'live') continue;
    console.warn(`${acct.id ?? 'acct_?'}  ${state.padEnd(16)} ${detail}`);
  }

  const blocked = counts.get('blocked') ?? 0;
  const rejected = counts.get('rejected') ?? 0;
  const unknown = counts.get('unknown') ?? 0;

  console.log(`${scanned} account(s): ${blocked} blocked, ${rejected} rejected, ` +
              `${counts.get('never-onboarded') ?? 0} never onboarded`);

  if (blocked) {
    console.warn('  repair: read the union of currently_due across every capability first:');
    console.warn(`  GET ${API}/accounts/{id}/capabilities`);
    console.warn('  repair: create an account link for the seller, ' +
                 'type=account_onboarding, collection_options[fields]=currently_due');
  }
  if (rejected) {
    console.warn('  repair: Dashboard, Connected accounts, open the account. ' +
                 'No API call clears a rejected.* or under_review reason.');
  }
  if (blocked || rejected || unknown) {
    console.warn('  check: an endpoint with connect=true subscribed to ' +
                 'account.updated turns this into an event instead of a ticket');
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
