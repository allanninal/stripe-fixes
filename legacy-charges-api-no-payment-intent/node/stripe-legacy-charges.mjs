/**
 * Report Stripe charges created without a PaymentIntent, and what it costs.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Charges. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Sort one charge by the API that created it and by what the issuer did. Pure,
 * so the rules can be tested without a network.
 *
 * A charge created through a PaymentIntent carries that intent's id, whatever
 * made it. A null or absent payment_intent is the legacy Charges API itself,
 * not a proxy for it. Returns [state, detail].
 */
export function classify(charge) {
  if (charge.payment_intent) return ['modern', 'created through a PaymentIntent'];

  const status = charge.status;
  const outcome = charge.outcome ?? {};
  const reason = outcome.reason ?? null;

  if (status === 'succeeded') {
    return ['legacy',
      'succeeded on the legacy Charges API: no 3D Secure was possible on this ' +
      'payment, and none was attempted'];
  }

  if (reason === 'authentication_required') {
    return ['unauthenticated',
      'declined for authentication_required: the Charges API cannot run 3D ' +
      'Secure, so retrying the same source declines again'];
  }

  if (status === 'failed') {
    return ['legacy_declined',
      `legacy charge declined (${reason ?? 'no outcome.reason'}): this one ` +
      'would likely have failed on the modern path too'];
  }

  if (status === 'pending') {
    return ['legacy_pending',
      'legacy charge still pending: an asynchronous method on an API with no ' +
      'intent to track it'];
  }

  return ['unknown', `unrecognised charge status: ${JSON.stringify(status)}`];
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

export async function* charges(key, since, cap = 20000) {
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

  const days = Number((process.env.DAYS || "dummy-days") ?? 90);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const counts = {};
  const amounts = {};
  let scanned = 0;
  for await (const ch of charges(key, since)) {
    scanned += 1;
    const [state, detail] = classify(ch);
    counts[state] = (counts[state] ?? 0) + 1;
    amounts[state] = (amounts[state] ?? 0) + (ch.amount ?? 0);
    if (state === 'unauthenticated' || state === 'unknown') {
      console.warn(`${ch.id ?? 'ch_?'}  ${state.padEnd(15)} ${detail}`);
    }
  }

  const legacyStates = ['legacy', 'unauthenticated', 'legacy_declined', 'legacy_pending'];
  const legacy = legacyStates.reduce((n, k) => n + (counts[k] ?? 0), 0);
  const blocked = counts.unauthenticated ?? 0;

  console.log(`${scanned} charge(s): ${counts.modern ?? 0} modern, ${legacy} ` +
              `legacy, ${blocked} declined for authentication`);

  if (legacy && scanned) {
    const volume = legacyStates.reduce((n, k) => n + (amounts[k] ?? 0), 0);
    console.warn(`  ${(100 * legacy / scanned).toFixed(1)}% of charges have no ` +
                 `PaymentIntent, ${volume} minor unit(s) of volume on an API ` +
                 'that cannot authenticate');
  }
  if (blocked) {
    console.warn(`  ${blocked} of those were declined for authentication_required. ` +
                 'A retry on the same source declines again.');
  }
  if (legacy) {
    console.warn(`  repair: replace POST ${API}/charges -d source=tok_... with`);
    console.warn(`  POST ${API}/payment_intents -d amount=... -d currency=... ` +
                 '-d customer=cus_... -d payment_method=pm_... -d confirm=true');
    console.warn('  and handle requires_action on the client. Convert stored ' +
                 'card_ sources to PaymentMethods before cutting over.');
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
