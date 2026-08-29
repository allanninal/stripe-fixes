/**
 * Report a missing or unusable Stripe Billing Portal configuration.
 *
 * Read only. Two GETs and no writes: give this a RESTRICTED key with read access
 * to the Customer Portal and Subscriptions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const PORTAL_SETTINGS = 'https://dashboard.stripe.com/settings/billing/portal';

/**
 * Classify the account's portal configuration. Pure, so it is testable offline.
 * A default that is not active satisfies a naive check and still fails every call.
 */
export function verdict(configurations, activeSubscriptions = 0) {
  const configs = configurations ?? [];
  const usable = configs.filter((c) => c.is_default && c.active);
  if (usable.length) {
    return ['configured',
      `default configuration ${usable[0].id ?? '<no id>'} is active; portal ` +
      'sessions resolve'];
  }
  if (configs.length === 0) {
    if (activeSubscriptions) {
      return ['erroring',
        `no portal configuration exists and ${activeSubscriptions} active ` +
        'subscription(s) can reach the portal: every session create is failing ' +
        'with 400 right now'];
    }
    return ['missing',
      'no portal configuration exists. The first session created without an ' +
      'explicit configuration will fail with 400.'];
  }
  const active = configs.filter((c) => c.active);
  if (active.length) {
    return ['explicit-only',
      `${active.length} active configuration(s) but none is the default ` +
      `(${active.slice(0, 3).map((c) => c.id ?? '?').join(', ')}). A session ` +
      'created without configuration=... fails with 400.'];
  }
  return ['inactive-default',
    `${configs.length} configuration(s) exist and none of them is active, so ` +
    'none can be used to open the portal'];
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

export async function configurations(key) {
  const out = [];
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/billing_portal/configurations', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

export async function activeSubscriptionCount(key, cap = 2000) {
  let count = 0;
  const params = { status: 'active', limit: 100 };
  for (;;) {
    const page = await get(key, '/subscriptions', params);
    const data = page.data ?? [];
    count += data.length;
    if (data.length === 0 || !page.has_more || count >= cap) break;
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
  if (key.startsWith('sk_test') || key.startsWith('rk_test')) {
    console.warn('this is a test-mode key: a result here says nothing about live, ' +
                 'which is where this failure happens');
  }

  const configs = await configurations(key);
  const subs = await activeSubscriptionCount(key);
  const [state, detail] = verdict(configs, subs);

  const line = `${state.padEnd(16)} ${detail}`;
  if (state === 'configured') { console.log(line); return; }

  console.warn(line);
  console.warn(`  ${subs} active subscription(s) can reach the portal`);
  console.warn(`  repair: save the portal settings once, in this mode, at ${PORTAL_SETTINGS}`);
  console.warn('  or create one over the API and pass its id explicitly:');
  console.warn(`  POST ${API}/billing_portal/configurations -d ` +
               '"features[invoice_history][enabled]=true" ...');
  console.warn(`  then POST ${API}/billing_portal/sessions -d customer=cus_... ` +
               '-d configuration=bpc_...');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
