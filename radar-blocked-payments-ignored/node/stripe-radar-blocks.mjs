/**
 * Report Stripe charges that Radar blocked before authorization.
 *
 * Read only. One paginated GET, no writes: give this a RESTRICTED key with read
 * access to Charges. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one charge. Pure, so the rules can be tested without a network.
 * A blocked charge never reached the issuer, so it has no decline code;
 * outcome.reason is the only account of what happened.
 */
export function classify(charge) {
  const outcome = charge.outcome ?? {};
  if (outcome.type !== 'blocked') {
    return ['not-blocked', `outcome.type ${JSON.stringify(outcome.type)}`];
  }
  const reason = outcome.reason ?? 'unknown';
  const seller = outcome.seller_message ?? 'no seller_message';
  if (reason === 'rule') {
    return ['rule', `a Radar rule you wrote stopped this before authorization: ${seller}`];
  }
  if (reason === 'highest_risk_level' || reason === 'elevated_risk_level') {
    return ['risk', `Radar's own ${reason} threshold, not a rule of yours: ${seller}`];
  }
  if (reason === 'low_probability_of_authorization') {
    return ['adaptive',
      'Adaptive Acceptance skipped an attempt it expected to fail. ' +
      'Not fraud; exclude it from fraud metrics.'];
  }
  return ['blocked-other', `blocked for ${JSON.stringify(reason)}: ${seller}`];
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

export async function* charges(key, since, cap) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/charges', params);
    const data = page.data ?? [];
    for (const ch of data) {
      yield ch;
      seen += 1;
      if (seen >= cap) return;
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

  const days = Number((process.env.DAYS || "dummy-days") ?? 30);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const counts = new Map();
  const byReason = new Map();
  const examples = [];
  let scanned = 0;

  for await (const ch of charges(key, since, 5000)) {
    scanned += 1;
    const [state, detail] = classify(ch);
    if (state === 'not-blocked') continue;
    counts.set(state, (counts.get(state) ?? 0) + 1);
    const reason = ch.outcome?.reason ?? 'unknown';
    const [n, amount] = byReason.get(reason) ?? [0, 0];
    byReason.set(reason, [n + 1, amount + (ch.amount ?? 0)]);
    if (examples.length < 10) examples.push([ch.id, detail]);
  }

  for (const [id, detail] of examples) console.warn(`${id}  ${detail}`);

  const blocked = [...counts.values()].reduce((a, b) => a + b, 0);
  const share = scanned ? (100 * blocked) / scanned : 0;
  console.log(`${scanned} charge(s): ${blocked} blocked (${share.toFixed(1)}%) - ` +
              `rule ${counts.get('rule') ?? 0}, risk ${counts.get('risk') ?? 0}, ` +
              `adaptive ${counts.get('adaptive') ?? 0}`);

  for (const [reason, [n, amount]] of [...byReason].sort((a, b) => b[1][0] - a[1][0])) {
    console.warn(`  ${reason.padEnd(32)} ${String(n).padStart(4)} charge(s), ` +
                 `${amount} in minor units`);
  }

  if (share > 2) {
    console.warn('  blocked charges are over 2% of volume, which is high enough ' +
                 'to be costing real revenue');
  }
  if (counts.get('rule')) {
    console.warn('  repair: Dashboard > Radar > Rules, find the rule named in ' +
                 'outcome.seller_message and narrow its scope or disable it');
  }
  if (counts.get('risk')) {
    console.warn('  repair: add a review rule before moving the block threshold, ' +
                 'so risky payments queue rather than vanish');
  }
  if (counts.get('adaptive')) {
    console.warn('  note: low_probability_of_authorization is Adaptive Acceptance ' +
                 "working; exclude it from fraud metrics rather than 'fixing' it");
  }
  process.exitCode = (counts.get('rule') || counts.get('risk')) ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
