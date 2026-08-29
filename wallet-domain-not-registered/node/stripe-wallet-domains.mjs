/**
 * Report domains where Apple Pay, Google Pay, Link or PayPal will not render.
 *
 * Read only. One GET request, no writes: give this a RESTRICTED key with read
 * access to Payment Method Domains. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const WALLETS = ['apple_pay', 'google_pay', 'link', 'paypal'];

/**
 * Wallets on this domain that are not active, with Stripe's own reason. Pure.
 *
 * Each wallet carries its own status, and the reason lives in
 * status_details.error_message rather than in the status.
 */
export function darkWallets(domain) {
  const out = [];
  for (const name of WALLETS) {
    const w = domain[name];
    if (!w || typeof w !== 'object') continue;
    if (w.status !== 'active') {
      const details = w.status_details ?? {};
      out.push([name, w.status, details.error_message ?? 'no reason given']);
    }
  }
  return out;
}

/**
 * Classify one registered domain. Pure. Returns [state, detail, dark].
 *
 * livemode is checked first: a healthy test-mode registration produces exactly
 * the symptom being investigated and must not read as a pass.
 */
export function verdict(domain) {
  if (!domain.livemode) {
    return ['test_only',
      'registered in test mode only, which has no effect on live traffic: live ' +
      'visitors see no wallet at all', []];
  }
  if (!domain.enabled) {
    return ['disabled',
      'registered but disabled, which filters the wallets out exactly as if it ' +
      'had never been registered', []];
  }
  const dark = darkWallets(domain);
  if (dark.length) {
    return ['dark', `${dark.length} wallet(s) not active on a live, enabled domain`,
            dark];
  }
  return ['active', 'every wallet active', []];
}

/**
 * Hosts you serve checkout from that have no registration at all. Pure.
 */
export function missingDomains(registered, serving) {
  const have = new Set(registered.map((d) => d.domain_name));
  return [...new Set(serving)].filter((d) => !have.has(d)).sort();
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

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }
  if (!key.includes('_live_')) {
    console.warn('this is a test-mode key: registrations here say nothing about ' +
      'what live visitors see');
  }

  const serving = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const { data: domains = [] } = await get(key, '/payment_method_domains',
                                           { limit: 100 });
  if (domains.length === 0) {
    console.warn('no payment method domains registered: every wallet is filtered ' +
      'out in production');
    console.warn(`  repair: POST ${API}/payment_method_domains ` +
      '-d domain_name=checkout.example.com in live mode');
    process.exitCode = 1;
    return;
  }

  let bad = 0;
  for (const d of domains) {
    const [state, detail, dark] = verdict(d);
    const line = `${state.padEnd(9)} ${d.domain_name ?? '?'}  ${detail}`;
    if (state === 'active') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    for (const [name, status, reason] of dark) {
      console.warn(`    ${name} is ${status}: ${reason}`);
    }
    if (state === 'test_only') {
      console.warn('  repair: register the same host again with a live key');
    } else if (state === 'disabled') {
      console.warn(`  repair: POST ${API}/payment_method_domains/${d.id} -d enabled=true`);
    } else {
      console.warn('  repair: serve /.well-known/' +
        'apple-developer-merchantid-domain-association from the host, then ' +
        `POST ${API}/payment_method_domains/${d.id}/validate`);
    }
  }

  for (const name of missingDomains(domains, serving)) {
    bad += 1;
    console.warn(`missing   ${name}  serves checkout and is not registered at all`);
    console.warn(`  repair: POST ${API}/payment_method_domains -d domain_name=${name}`);
  }

  console.log(`${domains.length} registered domain(s), ${bad} needing attention`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly, so importing this module from the test file
// does not execute main() and fail the suite on the missing key.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
