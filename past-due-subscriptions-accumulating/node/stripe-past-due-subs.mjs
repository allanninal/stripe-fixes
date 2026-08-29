/**
 * Report Stripe subscriptions parked in past_due while access continues.
 *
 * Read only. GET requests only, no writes: give this a RESTRICTED key with read
 * access to Subscriptions and Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// No retry schedule Stripe offers runs longer than a month, so an invoice older
// than this is not waiting on anything: the subscription has simply been left.
export const DUNNING_DAYS = 30;

/**
 * Classify one past_due subscription from its latest invoice.
 * Pure, so live dunning and a parked subscription can be told apart in a test.
 */
export function verdict(sub, now, dunningDays = DUNNING_DAYS) {
  const invoice = sub.latest_invoice;
  if (invoice === null || typeof invoice !== 'object') {
    return ['unknown',
      'latest_invoice was not expanded; re-run with expand[]=data.latest_invoice'];
  }
  const created = invoice.created;
  if (typeof created !== 'number') {
    return ['unknown', 'latest_invoice has no created timestamp to age'];
  }
  const attempts = invoice.attempt_count ?? 0;
  const days = (now - created) / 86400;
  if (attempts === 0) {
    return ['never-attempted',
      `invoice ${days.toFixed(0)} day(s) old with no payment attempt at all: ` +
      'usually no payment method resolves, so retries never run'];
  }
  if (days > dunningDays) {
    return ['parked',
      `${attempts} attempt(s), invoice ${days.toFixed(0)} day(s) old: past any ` +
      'retry schedule, so nothing further will happen to this on its own'];
  }
  return ['dunning',
    `${attempts} attempt(s) over ${days.toFixed(0)} day(s): retries are still ` +
    'running and this may recover'];
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

async function pageSubscriptions(key, status, limit, expand) {
  const out = [];
  const q = { status, limit: 100 };
  if (expand) q['expand[]'] = expand;
  for (;;) {
    const page = await get(key, '/subscriptions', q);
    out.push(...(page.data ?? []));
    if (!page.has_more || out.length >= limit) break;
    q.starting_after = page.data[page.data.length - 1].id;
  }
  return out.slice(0, limit);
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const pastDue = await pageSubscriptions(key, 'past_due', 1000, 'data.latest_invoice');
  const active = await pageSubscriptions(key, 'active', 1000);
  if (pastDue.length === 0) {
    console.log("no past_due subscriptions for this key's mode");
    return;
  }

  const now = Date.now() / 1000;
  const counts = new Map();
  for (const sub of pastDue) {
    const [state, detail] = verdict(sub, now);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    console.warn(`${state.padEnd(15)} ${sub.id ?? '?'}  ${detail}`);
    if (state === 'parked') {
      console.warn(`  repair: close it out with POST ${API}/subscriptions/${sub.id} ` +
        `-d cancel_at_period_end=true, or DELETE ${API}/subscriptions/${sub.id} ` +
        `to end it now`);
    } else if (state === 'never-attempted') {
      console.warn(`  repair: attach a payment method first, then pay invoice ` +
        `${sub.latest_invoice?.id ?? 'in_...'}`);
    }
  }

  const ratio = (100 * pastDue.length) / Math.max(1, pastDue.length + active.length);
  console.log(`${pastDue.length} past_due against ${active.length} active ` +
    `(${ratio.toFixed(1)}%), ${counts.get('parked') ?? 0} parked, ` +
    `${counts.get('never-attempted') ?? 0} never attempted`);
  console.warn('entitlement check: gate on status in (active, trialing), not on ' +
    'status != canceled');
  console.warn('billing setting: Billing > Revenue recovery > Retries, set the ' +
    'post-retry action to cancel or mark unpaid');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
