/**
 * Report Issuing cardholders whose requirements keep their cards inactive.
 *
 * Read only. Three GET requests and no writes: give this a RESTRICTED key with
 * read access to Issuing cardholders, Issuing cards and Issuing authorizations.
 * The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Fields under this prefix record that the cardholder accepted the Authorized
// User Terms. They are past due far more often than any identity field, and they
// are not a verification problem: nothing needs checking, the terms were never
// shown.
const TERMS_PREFIX = 'individual.card_issuing.user_terms_acceptance';

// What each decline reason actually implies. Six reasons, six unrelated repairs.
const DECLINE_HINTS = {
  card_inactive:
    'the card itself is not active. Activation is blocked while the cardholder ' +
    'has past-due requirements, so check the cardholder first.',
  cardholder_inactive:
    "the cardholder is not active. Its own status, not the card's, is the block.",
  verification_failed:
    "the cardholder's identity verification did not pass. Collecting the same " +
    'details again will not change it; read the requirements for what failed.',
  insufficient_funds:
    'the Issuing balance is empty, which has nothing to do with requirements. ' +
    'Read balance.issuing.available and top it up.',
  spending_controls:
    'a spending control on the card or cardholder rejected this. The card is ' +
    'working exactly as configured.',
  webhook_timeout:
    'your real-time authorization endpoint did not answer in time, so Stripe ' +
    'applied the default. This is your latency, not a cardholder problem.',
};

/** Turn an authorization decline reason into its repair. Pure. */
export function explainDecline(reason) {
  if (Object.prototype.hasOwnProperty.call(DECLINE_HINTS, reason)) {
    return DECLINE_HINTS[reason];
  }
  return `unrecognised reason ${JSON.stringify(reason)}: read the authorization's ` +
    'request_history';
}

/**
 * Classify one cardholder. Pure. Returns [state, detail].
 * The states separate three different jobs: capture a terms acceptance, collect
 * identity fields, or find out why your own code never called activation.
 */
export function verdict(cardholder, inactiveCards) {
  const reqs = cardholder.requirements ?? {};
  const pastDue = (reqs.past_due ?? []).filter(Boolean);
  const reason = reqs.disabled_reason ?? null;
  const cards = inactiveCards ? ` (${inactiveCards} inactive card(s) behind it)` : '';

  if (pastDue.length) {
    if (pastDue.every((f) => f.startsWith(TERMS_PREFIX))) {
      return ['blocked-terms',
        `past_due is only terms acceptance: ${pastDue.join(', ')}${cards}. Nothing ` +
        'needs verifying. Capture the IP and the timestamp at the moment the ' +
        'cardholder accepts the Authorized User Terms.'];
    }
    return ['blocked-identity',
      `${pastDue.length} field(s) past due: ${pastDue.slice(0, 4).join(', ')}${cards}. ` +
      'Activation stays blocked until every one is supplied.'];
  }

  if (reason) {
    return ['disabled',
      `disabled_reason ${reason} with nothing in past_due${cards}: read the ` +
      'requirements hash before collecting anything'];
  }

  if (cardholder.status !== 'active') {
    return ['inactive-cardholder',
      `status ${JSON.stringify(cardholder.status)} with no outstanding ` +
      `requirements${cards}: this was set deliberately, so find out by whom`];
  }

  if (inactiveCards) {
    return ['dormant',
      `cardholder is clean and ${inactiveCards} card(s) are still inactive: nothing ` +
      'is blocking activation, so nobody ever called it'];
  }

  return ['healthy', 'active, nothing past due'];
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

async function* paginate(key, path, cap, extra = {}) {
  let seen = 0;
  const params = { ...extra, limit: 100 };
  for (;;) {
    const page = await get(key, path, params);
    const data = page.data ?? [];
    for (const item of data) {
      yield item;
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

  const inactive = new Map();
  let totalInactive = 0;
  for await (const card of paginate(key, '/issuing/cards', 5000, { status: 'inactive' })) {
    totalInactive += 1;
    const holder = (card.cardholder ?? {}).id;
    if (holder) inactive.set(holder, (inactive.get(holder) ?? 0) + 1);
  }

  const counts = new Map();
  let cardholders = 0;
  for await (const holder of paginate(key, '/issuing/cardholders', 5000)) {
    cardholders += 1;
    const [state, detail] = verdict(holder, inactive.get(holder.id) ?? 0);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'healthy') continue;
    console.warn(`${holder.id ?? 'ich_?'}  ${state.padEnd(18)} ${detail}`);
  }

  const reasons = new Map();
  for await (const auth of paginate(key, '/issuing/authorizations', 1000)) {
    if (auth.approved) continue;
    for (const attempt of auth.request_history ?? []) {
      reasons.set(attempt.reason, (reasons.get(attempt.reason) ?? 0) + 1);
    }
  }

  const blocked = (counts.get('blocked-terms') ?? 0) + (counts.get('blocked-identity') ?? 0);
  console.log(`${cardholders} cardholder(s), ${totalInactive} inactive card(s): ` +
    `${blocked} blocked, ${counts.get('dormant') ?? 0} dormant`);

  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.warn(`  ${count} decline(s) with reason ${reason}: ${explainDecline(reason)}`);
  }

  if (counts.get('blocked-terms')) {
    console.warn(`  repair: POST ${API}/issuing/cardholders/{ich_id} with`);
    console.warn('  individual[card_issuing][user_terms_acceptance][date] and [ip], ' +
                 'captured when the cardholder accepted the terms');
  }
  if (counts.get('blocked-identity')) {
    console.warn(`  repair: POST ${API}/issuing/cardholders/{ich_id} supplying every ` +
                 'field listed in requirements.past_due');
  }
  if (blocked || counts.get('dormant')) {
    console.warn(`  then: POST ${API}/issuing/cards/{ic_id} with status=active. ` +
                 'Activation before the requirements clear does not stick.');
  }
  if (blocked || counts.get('dormant') || counts.get('disabled')
      || counts.get('inactive-cardholder')) {
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
