/**
 * Report unpaid subscriptions and the draft invoices stranded behind them.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access
 * to Subscriptions and Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one subscription and the draft invoices behind it. Pure, so the
 * rules are visible and testable without a network.
 */
export function verdict(sub, drafts) {
  const status = sub.status;
  if (status !== 'unpaid') {
    return ['not-unpaid',
      `status is ${JSON.stringify(status)}, which is a different problem than this one`];
  }

  // auto_advance false is Stripe saying this invoice will never finalise by
  // itself. On an unpaid subscription that is every invoice it generates.
  const closed = (drafts ?? []).filter((d) => !d.auto_advance);
  if (closed.length > 0) {
    const owed = closed.reduce((t, d) => t + (d.amount_due ?? 0), 0);
    return ['stranded',
      `${closed.length} draft invoice(s) worth ${owed} (minor units) were ` +
      'created and closed without a payment attempt'];
  }
  if ((drafts ?? []).length > 0) {
    return ['collecting',
      `${drafts.length} draft invoice(s) still carry auto_advance, so somebody ` +
      'has already restarted collection here'];
  }
  return ['silent',
    'no invoices since dunning ended. Billing stopped at the last past_due ' +
    'invoice and access is whatever your app still grants.'];
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

export async function pageAll(key, path, limit, params = {}) {
  const out = [];
  const q = { ...params, limit: 100 };
  for (;;) {
    const page = await get(key, path, q);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) break;
    q.starting_after = data[data.length - 1].id;
  }
  return out;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const subs = await pageAll(key, '/subscriptions', 500, { status: 'unpaid' });
  if (subs.length === 0) {
    console.log('0 unpaid subscription(s), 0 stranded draft invoice(s)');
    return;
  }

  let stranded = 0;
  for (const sub of subs) {
    const drafts = await pageAll(key, '/invoices', 100,
      { subscription: sub.id, status: 'draft' });
    const [state, detail] = verdict(sub, drafts);
    console.warn(`${state.padEnd(11)} ${sub.id}  ${detail}`);
    if (state === 'stranded') {
      stranded += drafts.length;
      console.warn(`  repair: for each draft, POST ${API}/invoices/{inv} ` +
                   '-d auto_advance=true (or /send to mail it)');
    }
    console.warn('  repair: gate provisioning on status in (active, trialing); ' +
                 'unpaid must revoke');
    console.warn('  repair: Billing, Revenue recovery, Retries: set the final ' +
                 'action to cancel instead of mark unpaid');
  }

  console.log(`${subs.length} unpaid subscription(s), ${stranded} stranded ` +
              'draft invoice(s)');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
