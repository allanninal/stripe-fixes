/**
 * Report Stripe Payment Links that are deactivated but still receiving traffic.
 *
 * Read only. Two GETs and no writes: give this a RESTRICTED key with read access
 * to Payment Links and Checkout Sessions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one Payment Link. Pure, so the rules can be tested without a network.
 * `active` may be null, which is not the same as false.
 */
export function verdict(active, recentSessions, inactiveMessage = null) {
  if (active === null || active === undefined) {
    return ['unknown',
      'the link has no active flag; treat it as published until you know ' +
      `otherwise (${recentSessions} recent session(s))`];
  }
  if (active) return ['live', `${recentSessions} session(s) in the window`];
  if (recentSessions) {
    if (inactiveMessage) {
      return ['dead-signposted',
        `inactive, ${recentSessions} recent session(s), and customers at least ` +
        `see: '${inactiveMessage}'`];
    }
    return ['dead-in-use',
      `inactive but still reached ${recentSessions} time(s) in the window: every ` +
      "one of those landed on Stripe's deactivation page"];
  }
  return ['dormant', 'inactive and nothing has reached it in the window'];
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

  const days = Number(process.argv[2] ?? 90);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  let bad = 0;
  for (const link of await paymentLinks(key)) {
    const count = await recentSessionCount(key, link.id, since);
    const [state, detail] = verdict(link.active, count, link.inactive_message);
    const line = `${state.padEnd(15)} ${link.id.padEnd(20)} ${detail}`;
    if (state === 'live' || state === 'dormant') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    console.warn(`  published at: ${link.url ?? '<no url>'}`);
    console.warn('  repair: repoint the published URL at a live link, or bring ' +
                 'this one back:');
    console.warn(`  POST ${API}/payment_links/${link.id} -d active=true`);
    if (!link.inactive_message) {
      console.warn('  if it stays dead, give the deactivation page a forwarding ' +
                   'instruction with -d inactive_message="..."');
    }
  }

  console.log(`${bad} inactive link(s) still taking traffic`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
