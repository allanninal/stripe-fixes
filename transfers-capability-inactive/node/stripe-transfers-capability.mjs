/**
 * Report connected accounts whose transfers capability is not active.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Reasons no amount of field collection will clear.
const DASHBOARD_ONLY = ['listed', 'under_review', 'rejected'];

/**
 * Sort the transfers capability of one account. Pure, so the states can be
 * tested without a network. `capability` is null when the account's capabilities
 * hash has no transfers key at all, which means it was never requested.
 * Returns [state, detail].
 */
export function classify(capability) {
  if (capability === null || capability === undefined) {
    return ['unrequested',
      'no transfers capability on the account: it was never requested, so ' +
      'Stripe is not asking for anything and funds will never move'];
  }

  const status = capability.status;
  const reqs = capability.requirements ?? {};
  const due = (reqs.currently_due ?? []).filter(Boolean);
  const verifying = (reqs.pending_verification ?? []).filter(Boolean);
  const reason = reqs.disabled_reason ?? null;

  if (status === 'active') return ['active', 'transfers are active'];

  if (status === 'unrequested') {
    return ['unrequested',
      'status unrequested: request the capability before collecting anything, ' +
      'because nothing is outstanding yet'];
  }

  if (status === 'pending') {
    const extra = verifying.length
      ? `, ${verifying.length} field(s) in pending_verification` : '';
    return ['verifying',
      `status pending: Stripe is checking what it already has${extra}. ` +
      'Collecting more fields does not speed it up'];
  }

  if (status === 'inactive') {
    if (due.length) {
      return ['blocked',
        `status inactive, ${due.length} field(s) currently due on this ` +
        `capability: ${due.slice(0, 4).join(', ')}`];
    }
    if (verifying.length) {
      return ['verifying',
        `status inactive with ${verifying.length} field(s) in ` +
        'pending_verification: submitted and being checked, nothing to collect'];
    }
    if (reason && (DASHBOARD_ONLY.includes(reason) || reason.split('.')[0] === 'rejected')) {
      return ['held',
        `status inactive, disabled_reason ${reason}: no API call clears this one`];
    }
    if (reason) {
      return ['blocked',
        `status inactive, disabled_reason ${reason} with nothing currently due: ` +
        'read every capability before collecting'];
    }
    return ['unknown', 'status inactive with no currently_due and no disabled_reason'];
  }

  return ['unknown', `unrecognised capability status: ${status}`];
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

  const counts = {};
  let scanned = 0;
  for await (const acct of accounts(key)) {
    scanned += 1;
    const caps = acct.capabilities ?? {};

    if (caps.transfers === 'active') {
      counts.active = (counts.active ?? 0) + 1;
      continue;
    }

    // Only fetch the capability object where the status is not already active:
    // it is the only place the reason lives.
    let capability = null;
    if ('transfers' in caps) {
      capability = await get(key, `/accounts/${acct.id}/capabilities/transfers`);
    }

    const [state, detail] = classify(capability);
    counts[state] = (counts[state] ?? 0) + 1;
    console.warn(`${acct.id ?? 'acct_?'}  ${state.padEnd(12)} ${detail}`);
  }

  const blocked = counts.blocked ?? 0;
  const held = counts.held ?? 0;
  const unrequested = counts.unrequested ?? 0;
  const unknown = counts.unknown ?? 0;

  console.log(`${scanned} account(s): ${counts.active ?? 0} active, ${blocked} ` +
              `blocked, ${unrequested} unrequested, ${held} held`);

  if (unrequested) {
    console.warn('  repair: request the capability first, then onboard for ' +
                 'whatever it asks for once Stripe starts asking:');
    console.warn(`  POST ${API}/accounts/{id}/capabilities/transfers  requested=true`);
  }
  if (blocked) {
    console.warn('  repair: read every capability and collect the union of ' +
                 'currently_due, since card_payments and transfers disable each other:');
    console.warn(`  GET ${API}/accounts/{id}/capabilities`);
  }
  if (held) {
    console.warn('  repair: Dashboard, Connected accounts. No field collection ' +
                 'clears a rejected.* or under_review reason.');
  }
  if (blocked || held || unrequested || unknown) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
