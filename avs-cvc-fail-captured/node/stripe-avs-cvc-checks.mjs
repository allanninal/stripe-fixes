/**
 * Report Stripe charges captured after an AVS or CVC check came back failed.
 *
 * Read only. One account read and one paginated GET: give this a RESTRICTED key
 * with read access to Account and Charges. The repair is printed, never run.
 */
const API = 'https://api.stripe.com/v1';

export const CHECK_FIELDS = ['cvc_check', 'address_postal_code_check',
                             'address_line1_check'];
const INCONCLUSIVE = new Set([null, undefined, 'unavailable', 'unchecked']);

/** True when the account is configured to decline on this check failing. */
function covered(field, declineOn) {
  const s = declineOn ?? {};
  return field === 'cvc_check' ? Boolean(s.cvc_failure) : Boolean(s.avs_failure);
}

/**
 * Classify one charge's verification result. Pure, so it tests offline.
 * `checks` is payment_method_details.card.checks, or null for a non-card charge.
 */
export function verdict(checks, captured, declineOn) {
  if (checks === null || checks === undefined) {
    return ['not_card', 'no card checks on this charge'];
  }
  const values = Object.fromEntries(CHECK_FIELDS.map((f) => [f, checks[f] ?? null]));
  if (CHECK_FIELDS.every((f) => values[f] === null)) {
    return ['uncollected',
      'no AVS or CVC result at all: the details were never collected, so there ' +
      'was nothing for the issuer to verify'];
  }
  const failed = CHECK_FIELDS.filter((f) => values[f] === 'fail').sort();
  if (failed.length && captured) {
    const uncovered = failed.filter((f) => !covered(f, declineOn));
    if (uncovered.length) {
      return ['captured_on_fail',
        `${failed.join(', ')} failed and the charge was captured: decline_on is ` +
        `not set for ${uncovered.join(', ')}`];
    }
    return ['captured_despite_setting',
      `${failed.join(', ')} failed and the charge was captured even though ` +
      'decline_on covers it: check the Radar rules are enabled'];
  }
  if (failed.length) {
    return ['held',
      `${failed.join(', ')} failed and the charge is not captured: this is still ` +
      'a decision you can make'];
  }
  const missing = CHECK_FIELDS.filter((f) => INCONCLUSIVE.has(values[f])).sort();
  if (missing.length) {
    return ['unverified', `no usable result for ${missing.join(', ')}`];
  }
  return ['verified', 'every collected check passed'];
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

async function page(key, path, cap, params = {}) {
  const out = [];
  const q = { ...params, limit: 100 };
  for (;;) {
    const p = await get(key, path, q);
    const data = p.data ?? [];
    out.push(...data);
    if (data.length === 0 || !p.has_more || out.length >= cap) break;
    q.starting_after = data[data.length - 1].id;
  }
  return out;
}

function cardChecks(charge) {
  const details = charge.payment_method_details ?? {};
  if (details.type !== 'card') return undefined;
  return (details.card ?? {}).checks ?? null;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const account = await get(key, '/account');
  const declineOn = account.settings?.card_payments?.decline_on ?? {};
  console.log(`decline_on: avs=${Boolean(declineOn.avs_failure)} ` +
              `cvc=${Boolean(declineOn.cvc_failure)}`);

  const days = Number((process.env.DAYS || "dummy-days") ?? 90);
  const since = Math.floor(Date.now() / 1000 - days * 86400);
  const charges = await page(key, '/charges', 5000, { 'created[gte]': since });

  const counts = {};
  const flagged = [];
  let cards = 0;
  for (const ch of charges) {
    const checks = cardChecks(ch);
    if (checks === undefined) continue;
    cards += 1;
    const [state, detail] = verdict(checks, ch.captured, declineOn);
    counts[state] = (counts[state] ?? 0) + 1;
    if (state === 'captured_on_fail' || state === 'captured_despite_setting' ||
        state === 'held') {
      flagged.push([ch, state, detail]);
    }
  }

  const bad = (counts.captured_on_fail ?? 0) + (counts.captured_despite_setting ?? 0);
  console.log(`${cards} card charge(s): ${bad} captured on a failed check, ` +
              `${counts.uncollected ?? 0} never collected`);

  for (const [ch, state, detail] of flagged) {
    console.warn(`${state.padEnd(24)} ${ch.id} ${detail}`);
  }

  if (flagged.length === 0 && !counts.uncollected) return;

  if (flagged.length) {
    console.warn('  enable the risk-scored built-ins in Dashboard, Radar, Rules: ' +
                 'postal code verification fails based on risk score, and CVC ' +
                 'verification fails based on risk score');
  }
  if (counts.uncollected) {
    console.warn(`  ${counts.uncollected} charge(s) had no checks at all. Collect the ` +
                 'details: set billing_address_collection to required on Checkout ' +
                 'Sessions, or collect the postal code in the Payment Element.');
  }
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
