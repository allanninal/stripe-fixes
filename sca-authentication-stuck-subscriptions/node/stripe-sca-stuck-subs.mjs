/**
 * Report Stripe subscriptions frozen on an unanswered 3DS authentication.
 *
 * Read only. One paginated GET with an expansion, no writes: give this a
 * RESTRICTED key with read access to Subscriptions, Invoices and PaymentIntents.
 * The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Find the PaymentIntent on an invoice across the Basil API change. Pure.
 *
 * Before 2025-03-31.basil the intent hangs off `invoice.payment_intent`. On
 * Basil and later it is reached through the invoice's `payments` collection.
 */
export function intentOf(invoice) {
  if (!invoice || typeof invoice !== 'object') return null;
  if (invoice.payment_intent && typeof invoice.payment_intent === 'object') {
    return invoice.payment_intent;
  }
  for (const payment of invoice.payments?.data ?? []) {
    const candidate = payment.payment?.payment_intent;
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
}

/**
 * Say why one incomplete subscription never activated. Pure.
 *
 * The subscription status is the same whichever way the first invoice failed,
 * so the answer is on the PaymentIntent behind it.
 */
export function verdict(sub) {
  if (sub.status !== 'incomplete') {
    return ['other', `status ${JSON.stringify(sub.status)}: not waiting on a first payment`];
  }

  const intent = intentOf(sub.latest_invoice);
  if (intent === null) {
    return ['unexpanded',
      'no PaymentIntent found on the first invoice: expand ' +
      'latest_invoice.payment_intent, or on 2025-03-31.basil and later read ' +
      'payments.data.payment.payment_intent'];
  }

  if (intent.status === 'requires_action') {
    const action = intent.next_action?.type;
    if (!action) {
      return ['no-next-action',
        'the intent wants authentication but nothing was prepared for the ' +
        'customer to do, so nobody can finish this one'];
    }
    return ['authentication',
      `the issuer asked for a challenge (${action}) and it was never shown to ` +
      'the customer; the payment is still live'];
  }

  if (intent.status === 'requires_payment_method') {
    const error = intent.last_payment_error ?? {};
    const code = error.decline_code ?? error.code ?? 'no code recorded';
    return ['declined',
      `the card failed (${code}): a decline, not an unanswered challenge, so ` +
      'this customer needs a different card'];
  }

  if (intent.status === 'requires_confirmation') {
    return ['unconfirmed',
      'the intent was created and never confirmed at all: the client never ' +
      'called confirm, so no bank has seen this payment'];
  }

  if (intent.status === 'processing') {
    return ['settling', 'the payment is in flight, nothing to do yet'];
  }

  return ['other',
    `payment_intent status ${JSON.stringify(intent.status)} on an incomplete subscription`];
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

async function* pageSubscriptions(key, limit) {
  let seen = 0;
  const params = {
    status: 'incomplete',
    limit: 100,
    'expand[]': 'data.latest_invoice.payment_intent',
  };
  for (;;) {
    const page = await get(key, '/subscriptions', params);
    const rows = page.data ?? [];
    for (const sub of rows) { yield sub; seen += 1; }
    if (!page.has_more || rows.length === 0 || seen >= limit) break;
    params.starting_after = rows[rows.length - 1].id;
  }
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const states = new Map();
  let scanned = 0;

  for await (const sub of pageSubscriptions(key, 1000)) {
    scanned += 1;
    const [state, detail] = verdict(sub);
    states.set(state, (states.get(state) ?? 0) + 1);
    if (state === 'authentication' || state === 'no-next-action' || state === 'unexpanded') {
      console.warn(`${state.padEnd(15)} ${sub.id ?? '?'}  ${detail}`);
    } else if (state === 'declined') {
      console.log(`${state.padEnd(15)} ${sub.id ?? '?'}  ${detail}`);
    }
  }

  if (scanned === 0) {
    console.log('no incomplete subscriptions');
    return;
  }

  const summary = [...states.entries()].sort().map(([k, n]) => `${n} ${k}`).join(', ');
  console.log(`${scanned} incomplete subscription(s): ${summary}`);

  if (states.get('unexpanded')) {
    console.warn('repair: re-run with the expansion that matches your API version; ' +
      'an unreadable row is not a healthy one');
  }

  const stuck = (states.get('authentication') ?? 0) + (states.get('no-next-action') ?? 0);
  if (!stuck) {
    console.log('nothing is waiting on an unanswered authentication');
    process.exitCode = states.get('unexpanded') ? 1 : 0;
    return;
  }

  console.warn('repair: Dashboard, Settings, Billing, Automatic collection: turn on ' +
    'reminder emails so Stripe sends the Hosted Invoice Page link when a payment ' +
    'needs authentication');
  console.warn('repair: handle invoice.payment_action_required and pass the client ' +
    'secret to stripe.handleNextAction in the signup flow');
  console.warn('note: authentication_required is a hard decline, so smart retries ' +
    'will never clear these on their own');
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
