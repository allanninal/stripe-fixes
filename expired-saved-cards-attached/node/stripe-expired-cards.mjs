/**
 * Report expired card PaymentMethods still attached to Stripe customers.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access
 * to Customers, Subscriptions and PaymentMethods. The repair is printed, never
 * performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one saved card against today. Pure, so the boundary is testable.
 * A card is valid through the END of its expiry month, so the same month in the
 * same year is still good.
 */
export function verdict(expMonth, expYear, nowYear, nowMonth, isDefault = false) {
  if (!expMonth || !expYear) {
    return ['unreadable',
      'no exp_month/exp_year on this payment method: it cannot be aged'];
  }
  const label = `${String(expMonth).padStart(2, '0')}/${expYear}`;
  const expired = expYear < nowYear || (expYear === nowYear && expMonth < nowMonth);
  if (expired && isDefault) {
    return ['expired-default',
      `expired ${label} and it is the billing default: the next renewal fails ` +
      'with expired_card'];
  }
  if (expired) {
    return ['expired',
      `expired ${label} and still attached. Nothing prunes it, so your UI keeps ` +
      'showing it as a card on file.'];
  }
  if (expYear === nowYear && expMonth === nowMonth) {
    return ['last-month',
      `valid to the end of ${label} and then it stops. This is the month a nudge ` +
      'still prevents the decline.'];
  }
  return ['valid', `good to ${label}`];
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

export async function billedCustomers(key, limit = 500) {
  const out = new Map();
  const params = { limit: 100, status: 'active' };
  for (;;) {
    const page = await get(key, '/subscriptions', params);
    const data = page.data ?? [];
    for (const sub of data) {
      const cus = typeof sub.customer === 'object' ? sub.customer?.id : sub.customer;
      if (!cus) continue;
      if (!out.has(cus)) out.set(cus, new Set());
      const pm = typeof sub.default_payment_method === 'object'
        ? sub.default_payment_method?.id
        : sub.default_payment_method;
      if (pm) out.get(cus).add(pm);
    }
    if (data.length === 0 || !page.has_more || out.size >= limit) break;
    params.starting_after = data[data.length - 1].id;
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

  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;

  const customers = await billedCustomers(key);
  if (customers.size === 0) {
    console.log("no active subscriptions for this key's mode");
    return;
  }

  let bad = 0;
  for (const [cus, subDefaults] of customers) {
    const customer = await get(key, `/customers/${cus}`);
    const defaults = new Set(subDefaults);
    const settingsDefault = customer.invoice_settings?.default_payment_method;
    if (settingsDefault) defaults.add(settingsDefault);

    const { data: pms = [] } = await get(key, '/payment_methods',
      { customer: cus, type: 'card', limit: 100 });
    for (const pm of pms) {
      const card = pm.card ?? {};
      const [state, detail] = verdict(card.exp_month, card.exp_year,
        nowYear, nowMonth, defaults.has(pm.id));
      const line = `${state.padEnd(15)} ${cus}  ${pm.id}  ${detail}`;
      if (state === 'valid' || state === 'last-month') { console.log(line); continue; }
      bad += 1;
      console.warn(line);
      console.warn(`  repair: POST ${API}/payment_methods/${pm.id}/detach, then ` +
                   'send the customer a Customer Portal session or a SetupIntent ' +
                   'to add a new card');
      console.warn('  and subscribe to payment_method.automatically_updated so ' +
                   'network updates refresh your local exp_month/exp_year');
    }
  }

  console.log(`${customers.size} billed customer(s), ${bad} expired card(s) ` +
              'still attached');
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
