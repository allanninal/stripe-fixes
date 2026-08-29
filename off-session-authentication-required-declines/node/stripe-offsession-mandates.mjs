/**
 * Report customers whose saved cards cannot be charged off-session.
 *
 * Read only. GET requests only, no writes: give this a RESTRICTED key with read
 * access to PaymentIntents, SetupIntents and PaymentMethods. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Both mean the issuer wanted the cardholder present. The second is what Stripe
// returns when the integration never handled the step-up at all.
const STEP_UP = new Set(['authentication_required', 'authentication_not_handled']);

/**
 * True when this intent failed for want of authentication. Pure.
 *
 * The generic `code` is `card_declined` on all of these, so the distinguishing
 * value is one level down in `decline_code`.
 */
export function isStepUpDecline(intent) {
  const err = intent.last_payment_error ?? {};
  return STEP_UP.has(err.decline_code);
}

/**
 * True when some SetupIntent for this customer actually produced a mandate. Pure.
 *
 * An abandoned SetupIntent proves nothing: it has to have succeeded and to carry
 * a non-null mandate.
 */
export function hasMandate(setupIntents) {
  return setupIntents.some((si) => si.status === 'succeeded' && si.mandate);
}

/**
 * Classify one customer. Pure.
 */
export function verdict(declines, savedCards, setupIntents) {
  const mandated = hasMandate(setupIntents);
  if (declines && !mandated) {
    return ['unmandated',
      `${declines} off-session decline(s) and no succeeded SetupIntent carrying ` +
      'a mandate: the card was attached directly, so every retry declines identically'];
  }
  if (declines) {
    return ['stepped_up',
      `${declines} off-session decline(s) despite a mandate on file: the issuer ` +
      'asked for the cardholder anyway, so this charge has to be finished on-session'];
  }
  if (savedCards && !mandated) {
    return ['at_risk',
      `${savedCards} saved card(s) with no mandate behind them: nothing has ` +
      'failed yet only because nothing has been charged off-session yet'];
  }
  if (savedCards) return ['covered', 'saved cards are backed by a mandate'];
  return ['clear', 'no saved cards to charge off-session'];
}

async function get(key, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (res.status === 403) {
    throw new Error(`403 from Stripe: the restricted key lacks read access to ${path}`);
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export async function declinesByCustomer(key, since, cap = 5000) {
  const counts = new Map();
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/payment_intents', params);
    const rows = page.data ?? [];
    for (const pi of rows) {
      seen += 1;
      if (pi.customer && isStepUpDecline(pi)) {
        counts.set(pi.customer, (counts.get(pi.customer) ?? 0) + 1);
      }
    }
    if (!rows.length || !page.has_more || seen >= cap) break;
    params.starting_after = rows[rows.length - 1].id;
  }
  return { counts, seen };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  const { counts, seen } = await declinesByCustomer(key, since);
  if (counts.size === 0) {
    console.log(`sampled ${seen} intent(s), no authentication_required declines`);
    return;
  }

  let unmandated = 0;
  let steppedUp = 0;
  for (const [customer, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const { data: sis = [] } = await get(key, '/setup_intents',
                                         { customer, limit: 100 });
    const { data: cards = [] } = await get(key, '/payment_methods',
                                           { customer, type: 'card', limit: 100 });
    const [state, detail] = verdict(n, cards.length, sis);
    console.warn(`${state.padEnd(11)} ${customer}  ${detail}`);
    if (state === 'unmandated') {
      unmandated += 1;
      console.warn('  repair: send a SetupIntent link so the customer ' +
        're-authenticates, then charge with off_session=true and confirm=true');
    } else if (state === 'stepped_up') {
      steppedUp += 1;
      console.warn('  repair: bring the customer back on-session for this charge; ' +
        'do not schedule another off-session retry');
    }
  }

  console.warn('  repair: stop attaching cards directly. Save with a SetupIntent ' +
    'using usage=off_session, or setup_future_usage=off_session during a payment');
  console.log(`${counts.size} customer(s) declining: ${unmandated} unmandated, ` +
              `${steppedUp} stepped up`);
  process.exitCode = 1;
}

// Only run when invoked directly, so importing this module from the test file
// does not execute main() and fail the suite on the missing key.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
