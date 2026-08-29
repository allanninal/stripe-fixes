/**
 * Report Stripe trials ending soon with no payment method on file.
 *
 * Read only. GET requests only, no writes: give this a RESTRICTED key with read
 * access to Subscriptions and Customers. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Stripe fires customer.subscription.trial_will_end three days out, so this is the
// window in which a warning email is still the documented remedy.
export const HORIZON = 259200;

const OUTCOMES = {
  create_invoice: 'Stripe invoices on the trial end date, the invoice fails ' +
    'immediately, and the subscription drops into past_due',
  pause: 'the subscription moves to paused and stops invoicing, which is ' +
    'recoverable but earns nothing until someone resumes it',
  cancel: 'the subscription is cancelled outright on the trial end date',
};

/**
 * Classify one trialing subscription. Pure, so the horizon can be tested.
 */
export function verdict(sub, now, horizon = HORIZON) {
  if (sub.default_payment_method || sub.default_source) {
    return ['carded', 'a payment method resolves, so the trial will convert'];
  }
  const customer = sub.customer;
  if (customer === null || typeof customer !== 'object') {
    return ['unknown',
      'customer was not expanded, so the customer-level default cannot be read; ' +
      're-run with expand[]=data.customer'];
  }
  const settings = customer.invoice_settings ?? {};
  if (settings.default_payment_method) {
    return ['carded', 'falls back to customer.invoice_settings.default_payment_method'];
  }

  const behaviour = sub.trial_settings?.end_behavior?.missing_payment_method
    ?? 'create_invoice';
  const outcome = OUTCOMES[behaviour]
    ?? `end behaviour ${JSON.stringify(behaviour)} is not one Stripe documents`;

  const trialEnd = sub.trial_end;
  if (typeof trialEnd !== 'number') {
    return ['no-card', 'no payment method and no trial_end to schedule against'];
  }
  const remaining = trialEnd - now;
  if (remaining <= horizon) {
    return ['imminent',
      `no payment method, trial ends in ${(remaining / 3600).toFixed(0)} h: ${outcome}`];
  }
  return ['no-card',
    `no payment method, trial ends in ${(remaining / 86400).toFixed(0)} day(s): ${outcome}`];
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

async function pageTrialing(key, limit) {
  const out = [];
  const q = { status: 'trialing', limit: 100, 'expand[]': 'data.customer' };
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

  const subs = await pageTrialing(key, 1000);
  if (subs.length === 0) {
    console.log("no trialing subscriptions for this key's mode");
    return;
  }

  const now = Date.now() / 1000;
  const counts = new Map();
  for (const sub of subs) {
    const [state, detail] = verdict(sub, now);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'carded') continue;
    const line = `${state.padEnd(9)} ${sub.id ?? '?'}  ${detail}`;
    if (state === 'no-card') { console.log(line); continue; }
    console.warn(line);
    const cus = typeof sub.customer === 'object' && sub.customer !== null
      ? sub.customer.id : sub.customer;
    console.warn(`  repair: email ${cus ?? 'the customer'} a billing-portal link ` +
      `and collect a card before ${sub.trial_end}`);
    console.warn(`  and choose the end behaviour deliberately: ` +
      `POST ${API}/subscriptions/${sub.id} ` +
      `-d trial_settings[end_behavior][missing_payment_method]=pause`);
  }

  console.log(`${subs.length} trialing, ${counts.get('imminent') ?? 0} ending ` +
    `within 72h with no card, ${counts.get('no-card') ?? 0} with no card further out`);
  if (counts.get('unknown')) {
    console.warn(`${counts.get('unknown')} row(s) could not be classified: re-run ` +
      'with the customer expanded');
  }
  if (counts.get('imminent')) {
    console.warn('subscribe to customer.subscription.trial_will_end; it fires three ' +
      'days out, which is the window this check reports on');
  }
  process.exitCode = (counts.get('imminent') ?? 0) + (counts.get('unknown') ?? 0)
    ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
