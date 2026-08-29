/**
 * Report expired Stripe Checkout Sessions that can never be recovered by email.
 *
 * Read only. Two paginated GETs and no writes: give this a RESTRICTED key with
 * read access to Checkout Sessions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one expired Checkout Session. Pure, so the rules can be tested
 * offline. `now` is unix seconds, passed in rather than read, so the recovery
 * URL's own expiry boundary can be pinned in a test.
 */
export function verdict(session, now) {
  const recovery = session.after_expiration?.recovery ?? {};
  if (!recovery.enabled) {
    return ['no-recovery',
      'after_expiration[recovery][enabled] was not set at creation, so this ' +
      'lapse has no recovery url and never will'];
  }

  const url = String(recovery.url ?? '').trim();
  if (!url) {
    return ['unknown',
      'recovery is enabled but no url is present on an expired session'];
  }

  const expiresAt = recovery.expires_at;
  if (expiresAt != null && expiresAt <= now) {
    const ago = ((now - expiresAt) / 86400).toFixed(1);
    return ['lapsed',
      `the recovery url expired ${ago} day(s) ago; mailing it now sends the ` +
      'customer to a dead link'];
  }

  const left = expiresAt == null ? NaN : ((expiresAt - now) / 86400);
  const consent = session.consent?.promotions;
  if (consent !== 'opt_in') {
    return ['no-consent',
      `the recovery url is live for ${left.toFixed(1)} more day(s), but ` +
      `consent.promotions is ${JSON.stringify(consent)}: there is no recorded ` +
      'permission to mail this address'];
  }

  return ['recoverable',
    `the recovery url is live for ${left.toFixed(1)} more day(s) and the ` +
    'customer opted in'];
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

export async function* sessionsWithStatus(key, status, since, limit = 5000) {
  let seen = 0;
  const params = { limit: 100, status, 'created[gte]': Math.floor(since) };
  for (;;) {
    const page = await get(key, '/checkout/sessions', params);
    const data = page.data ?? [];
    for (const s of data) { yield s; seen += 1; }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
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

  const days = Number(process.argv[2] ?? 60);
  const now = Date.now() / 1000;
  const since = now - days * 86400;

  const tally = { 'no-recovery': 0, lapsed: 0, 'no-consent': 0, recoverable: 0, unknown: 0 };
  let expired = 0;
  for await (const s of sessionsWithStatus(key, 'expired', since)) {
    expired += 1;
    const [state] = verdict(s, now);
    tally[state] = (tally[state] ?? 0) + 1;
  }

  let completed = 0;
  let recovered = 0;
  for await (const s of sessionsWithStatus(key, 'complete', since)) {
    completed += 1;
    if (s.recovered_from) recovered += 1;
  }

  console.log(`${expired} expired: ${tally['no-recovery']} no-recovery, ` +
              `${tally.lapsed} lapsed, ${tally['no-consent']} no-consent, ` +
              `${tally.recoverable} recoverable`);
  console.log(`${completed} completed session(s), ${recovered} carrying recovered_from`);

  if (tally['no-recovery']) {
    console.warn(`  repair: POST ${API}/checkout/sessions ` +
                 `-d 'after_expiration[recovery][enabled]=true' ` +
                 `-d 'consent_collection[promotions]=auto'`);
  }
  if (tally['no-consent']) {
    console.warn('  recovery urls exist but consent.promotions is not opt_in; ' +
                 "add -d 'consent_collection[promotions]=auto' at creation");
  }
  if (tally.lapsed) {
    console.warn('  recovery urls went past after_expiration.recovery.expires_at ' +
                 'before anything sent them; check expires_at at send time');
  }
  if (expired && !recovered) {
    console.warn('  no completed session carries recovered_from: nothing has ever ' +
                 'come back through a recovery url');
    console.warn('  subscribe checkout.session.expired and mail ' +
                 'after_expiration.recovery.url to customer_details.email');
  }

  process.exitCode =
    (tally['no-recovery'] || tally.lapsed || tally['no-consent']) ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
