/**
 * Report saved Stripe cards expiring within the next 60 days.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access
 * to Subscriptions, Customers and PaymentMethods. The repair is printed only.
 */
const API = 'https://api.stripe.com/v1';

export const WINDOW_DAYS = 60; // how far ahead to look
const NUDGE_DAYS = 45;         // when to send the first email
// Wallet-backed credentials are network tokens: the issuer reissues them along
// with the card, so their printed expiry date is not a churn event.
const TOKENISED_WALLETS = new Set(['apple_pay', 'google_pay', 'link', 'samsung_pay']);

/**
 * Unix seconds at which a card stops being valid: the start of the month after
 * its expiry month, with December rolled into the next year explicitly.
 */
export function expiresAt(expMonth, expYear) {
  let month = Number(expMonth);
  let year = Number(expYear);
  if (month === 12) { month = 1; year += 1; } else { month += 1; }
  return Date.UTC(year, month - 1, 1) / 1000;
}

/**
 * Classify one saved card. Pure, so the boundaries can be tested offline.
 * `daysLeft` is null when the PaymentMethod carries no usable expiry.
 */
export function verdict(daysLeft, isDefault = false, wallet = null) {
  if (daysLeft === null || daysLeft === undefined) {
    return ['unreadable', 'no exp_month/exp_year on this payment method'];
  }
  if (daysLeft <= 0) {
    return ['expired',
      `already expired${isDefault ? ' and it is the billing default' : ''}; ` +
      'this is a decline that has happened, not one coming'];
  }
  if (TOKENISED_WALLETS.has(wallet)) {
    return ['tokenised',
      `prints an expiry in ${daysLeft.toFixed(0)} day(s) but is a ${wallet} ` +
      'credential, which is reissued with the card. Do not email this customer.'];
  }
  if (daysLeft > WINDOW_DAYS) {
    return ['ok',
      `expires in ${daysLeft.toFixed(0)} day(s), outside the ${WINDOW_DAYS} day window`];
  }
  if (isDefault) {
    return ['urgent',
      `expires in ${daysLeft.toFixed(0)} day(s) and is the billing default: name ` +
      'the renewal that fails and email the portal link today'];
  }
  return ['warn',
    `expires in ${daysLeft.toFixed(0)} day(s); the nudge belongs at ${NUDGE_DAYS} ` +
    'days, before the decline rather than after it'];
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

export async function pageAll(key, path, limit, params = {}) {
  const out = [];
  const q = { limit: 100, ...params };
  for (;;) {
    const page = await get(key, path, q);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) return out;
    q.starting_after = data[data.length - 1].id;
  }
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const now = Date.now() / 1000;
  let flagged = 0;
  const seen = new Set();
  for (const sub of await pageAll(key, '/subscriptions', 1000, { status: 'active' })) {
    const cid = sub.customer;
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);

    const customer = await get(key, `/customers/${cid}`);
    const defaults = new Set([
      sub.default_payment_method,
      customer.invoice_settings?.default_payment_method,
    ].filter(Boolean));

    const pms = await get(key, '/payment_methods', { customer: cid, type: 'card', limit: 100 });
    for (const pm of pms.data ?? []) {
      const card = pm.card ?? {};
      const daysLeft = (card.exp_month && card.exp_year)
        ? (expiresAt(card.exp_month, card.exp_year) - now) / 86400
        : null;
      const [state, detail] = verdict(daysLeft, defaults.has(pm.id), card.wallet?.type ?? null);

      const line = `${state.padEnd(10)} ${cid}  ${pm.id}  ${detail}`;
      if (state === 'ok' || state === 'tokenised') { console.log(line); continue; }
      console.warn(line);
      flagged += 1;
    }
  }

  if (!flagged) {
    console.log(`clear      no card on an active subscription expires within ${WINDOW_DAYS} days`);
    return;
  }

  console.warn(`  ${flagged} card(s) need a nudge. Email a portal link, do not wait for the decline:`);
  console.warn(`  POST ${API}/billing_portal/sessions -d customer=cus_X -d return_url=https://example.com/billing`);
  console.warn('  and turn on Smart Retries at https://dashboard.stripe.com/settings/billing/automatic');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
