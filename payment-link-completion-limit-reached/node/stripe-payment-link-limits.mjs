/**
 * Report Stripe Payment Links that have reached their completed-session limit.
 *
 * Read only. Two GETs and no writes: give this a RESTRICTED key with read access
 * to Payment Links and Checkout Sessions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const NEAR = 0.9; // far enough along the cap that it closes before anyone looks again

/**
 * Classify one Payment Link's completion cap. Pure, so it is testable offline.
 * A missing counter is unread, not zero.
 */
export function verdict(restrictions, recentSessions = 0) {
  const completed = (restrictions ?? {}).completed_sessions ?? {};
  const limit = completed.limit;
  const count = completed.count;
  if (limit === null || limit === undefined) {
    return ['uncapped', 'no completion limit set'];
  }
  if (count === null || count === undefined) {
    return ['unknown',
      `capped at ${limit} and the counter is missing from the response; treat it ` +
      'as unread rather than as zero'];
  }
  if (count >= limit) {
    if (recentSessions) {
      return ['exhausted-in-use',
        `${count} of ${limit} completed session(s): the cap is met and ` +
        `${recentSessions} customer(s) have still arrived since`];
    }
    return ['exhausted',
      `${count} of ${limit} completed session(s): the cap is met and the link no ` +
      'longer accepts completions'];
  }
  if (limit && count / limit >= NEAR) {
    return ['near-limit',
      `${count} of ${limit} completed session(s): this link closes itself within ` +
      'days at the current rate'];
  }
  return ['headroom', `${count} of ${limit} completed session(s)`];
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

export async function paymentLinks(key, cap = 500) {
  const out = [];
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/payment_links', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= cap) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

export async function recentSessionCount(key, linkId, since) {
  let count = 0;
  const params = { payment_link: linkId, limit: 100 };
  for (;;) {
    const page = await get(key, '/checkout/sessions', params);
    const data = page.data ?? [];
    for (const cs of data) if ((cs.created ?? 0) >= since) count += 1;
    if (data.length === 0 || !page.has_more) break;
    if ((data[data.length - 1].created ?? 0) < since) break;
    params.starting_after = data[data.length - 1].id;
  }
  return count;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number(process.argv[2] ?? 30);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  let bad = 0;
  for (const link of await paymentLinks(key)) {
    const restrictions = link.restrictions;
    const recent = restrictions ? await recentSessionCount(key, link.id, since) : 0;
    const [state, detail] = verdict(restrictions, recent);
    const line = `${state.padEnd(17)} ${link.id.padEnd(20)} ${detail}`;
    if (state === 'uncapped' || state === 'headroom') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    console.warn(`  published at: ${link.url ?? '<no url>'}`);
    console.warn('  repair: raise the cap and keep the same URL:');
    console.warn(`  POST ${API}/payment_links/${link.id} -d ` +
                 '"restrictions[completed_sessions][limit]=<higher>"');
    console.warn('  or create a fresh link for the next tranche and swap the ' +
                 'published URL everywhere it appears');
  }

  console.log(`${bad} capped link(s) at or near their completion limit`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
