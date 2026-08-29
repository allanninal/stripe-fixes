/**
 * Report Stripe card charges captured at elevated risk without 3D Secure.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Charges. The Radar rules that repair this are printed, never
 * applied, because a rule change reprices every payment on the account.
 */
const API = 'https://api.stripe.com/v1';

const ELEVATED = ['elevated', 'highest'];
const AUTHENTICATED = 'authenticated';
export const SHARE_FLOOR = 0.10;

/**
 * Classify one charge. Pure. Returns [state, detail].
 */
export function classify(charge) {
  const pmd = charge.payment_method_details ?? {};
  if (pmd.type !== 'card') {
    return ['not_card',
      `${pmd.type ?? 'no payment method details'}, which authenticates ` +
      'differently or not at all'];
  }
  if (charge.status !== 'succeeded') {
    return ['not_settled',
      `status is ${JSON.stringify(charge.status)}, so it cannot be disputed`];
  }

  const risk = (charge.outcome ?? {}).risk_level;
  const tds = (pmd.card ?? {}).three_d_secure;

  if (tds === null || tds === undefined) {
    if (ELEVATED.includes(risk)) {
      return ['unprotected',
        `risk_level ${risk} captured with three_d_secure null. Radar flagged ` +
        'it, nothing authenticated it, and the fraud liability is yours.'];
    }
    return ['no_3ds',
      `risk_level ${risk ?? 'unknown'}, no authentication. Ordinary, but it ` +
      'counts against the account 3DS share.'];
  }

  const result = tds.result;
  if (result === AUTHENTICATED) {
    return ['protected',
      'authenticated; liability for most fraud disputes sits with the issuer'];
  }
  if (ELEVATED.includes(risk)) {
    return ['attempted',
      `three_d_secure.result is ${JSON.stringify(result)} on a ${risk} risk ` +
      'charge. The flow ran and the issuer did not complete it, so this looks ' +
      'covered and is not.'];
  }
  return ['attempted',
    `three_d_secure.result is ${JSON.stringify(result)}, which is not an authentication`];
}

/**
 * Account-wide 3DS share. Pure. Returns [state, detail]. Only authenticated
 * charges count in the numerator; an acknowledged attempt is not an
 * authentication.
 */
export function coverage(authenticated, cardCharges, floor = SHARE_FLOOR) {
  if (!cardCharges) return ['no_volume', 'no card charges in the window'];
  const share = authenticated / cardCharges;
  if (share <= floor) {
    return ['low',
      `${(share * 100).toFixed(1)}% of card charges authenticated, at or below ` +
      `the ${(floor * 100).toFixed(0)}% where Mastercard fraud monitoring applies`];
  }
  return ['ok', `${(share * 100).toFixed(1)}% of card charges authenticated`];
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

export async function* charges(key, since, limit = 5000) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': Math.floor(since) };
  for (;;) {
    const page = await get(key, '/charges', params);
    const data = page.data ?? [];
    for (const c of data) { yield c; seen += 1; }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
}

const REQUEST_RULE =
  "Request 3D Secure if :risk_level: != 'normal' and :amount_in_usd: > 25";
const BLOCK_RULE =
  "Block if not :is_3d_secure: and :risk_level: != 'normal' and not " +
  ":is_off_session: and :digital_wallet: != 'apple_pay' and not " +
  "(:digital_wallet: = 'android_pay' and :has_cryptogram:)";

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = process.argv.includes('--days')
    ? Number(process.argv[process.argv.indexOf('--days') + 1]) : 90;
  const since = Date.now() / 1000 - days * 86400;

  const states = new Map();
  let cardCharges = 0;
  let authenticated = 0;
  const findings = [];

  for await (const c of charges(key, since)) {
    const [state, detail] = classify(c);
    states.set(state, (states.get(state) ?? 0) + 1);
    if (state === 'not_card') continue;
    if (state !== 'not_settled') cardCharges += 1;
    if (state === 'protected') authenticated += 1;
    if (state === 'unprotected' || state === 'attempted') {
      findings.push([c, state, detail]);
    }
  }

  for (const [c, state, detail] of findings) {
    console.warn(`${state.padEnd(12)} ${c.id ?? '?'}  ${c.amount} ` +
                 `${(c.currency ?? '?').toUpperCase()}  ${detail}`);
  }

  const [shareState, shareDetail] = coverage(authenticated, cardCharges);
  console.log(`${cardCharges} card charge(s): ${states.get('unprotected') ?? 0} ` +
              `unprotected, ${states.get('attempted') ?? 0} attempted, ` +
              `${authenticated} authenticated`);
  if (shareState === 'low') console.warn(`3DS share: ${shareDetail}`);
  else console.log(`3DS share: ${shareDetail}`);

  if (findings.length || shareState === 'low') {
    console.warn('  repair, in Dashboard, Radar, Rules, add both together:');
    console.warn(`    ${REQUEST_RULE}`);
    console.warn(`    ${BLOCK_RULE}`);
    console.warn('  the request rule alone lets cards whose issuer will not ' +
                 'authenticate proceed unauthenticated anyway');
    console.warn('  note that early fraud warnings still arrive on authenticated ' +
                 'payments and still count toward the Visa VAMP ratio');
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
