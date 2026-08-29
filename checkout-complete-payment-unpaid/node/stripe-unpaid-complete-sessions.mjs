/**
 * Report Stripe Checkout Sessions that are complete but were never paid.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access to
 * Checkout Sessions and PaymentIntents. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Payment methods that settle after the session completes rather than during it.
export const DELAYED = ['us_bank_account', 'sepa_debit', 'boleto', 'konbini', 'oxxo'];

// PaymentIntent states that mean the async payment is already lost.
const DEAD_INTENT = ['requires_payment_method', 'canceled'];

/**
 * Classify one Checkout Session. Pure, so the rules can be tested offline.
 * status and payment_status are independent: complete does not mean paid.
 */
export function verdict(status, paymentStatus, intentStatus = null, methods = null) {
  if (status !== 'complete') {
    return ['skipped',
      `status is '${status}'; this check only looks at complete sessions`];
  }
  if (paymentStatus === 'no_payment_required') {
    return ['free', 'nothing to collect on this session'];
  }
  if (paymentStatus === 'paid') {
    return ['paid', 'payment_status is paid; fulfilment is safe'];
  }

  const delayed = (methods ?? []).filter((m) => DELAYED.includes(m)).sort();
  const note = delayed.length
    ? ` Delayed method(s) on the session: ${delayed.join(', ')}.`
    : '';
  if (intentStatus === 'processing') {
    return ['processing',
      'complete but unpaid, and the PaymentIntent is still processing. Wait for ' +
      'checkout.session.async_payment_succeeded before fulfilling.' + note];
  }
  if (DEAD_INTENT.includes(intentStatus)) {
    return ['failed',
      `complete but unpaid, and the PaymentIntent is ${intentStatus}: the payment ` +
      'failed after the session completed. Anything fulfilled against it has to ' +
      'be unwound.' + note];
  }
  return ['unpaid',
    'complete but payment_status is unpaid, and the PaymentIntent state is ' +
    `${intentStatus ?? 'unknown'}. Do not treat completed as paid.` + note];
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

export async function completeSessions(key, since, cap = 5000) {
  const out = [];
  const params = { status: 'complete', 'created[gte]': since, limit: 100 };
  for (;;) {
    const page = await get(key, '/checkout/sessions', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= cap) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

export async function intentStatus(key, csId) {
  const cs = await get(key, `/checkout/sessions/${csId}`, { 'expand[]': 'payment_intent' });
  const intent = cs.payment_intent;
  return intent && typeof intent === 'object' ? intent.status : null;
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
  let failed = 0;
  let waiting = 0;
  for (const cs of await completeSessions(key, since)) {
    if (cs.payment_status !== 'unpaid') continue;
    const pi = await intentStatus(key, cs.id);
    const [state, detail] = verdict(cs.status, cs.payment_status, pi,
      cs.payment_method_types);
    console.warn(`${state.padEnd(11)} ${cs.id.padEnd(28)} ${detail}`);
    if (state === 'failed') failed += 1; else waiting += 1;
  }

  console.log(`${failed} session(s) fulfilled against a payment that has already ` +
              `failed, ${waiting} still in flight`);
  if (failed || waiting) {
    console.warn('  repair: gate fulfilment on payment_status != "unpaid", not on ' +
                 'the completed event alone');
    console.warn('  and subscribe the event destination to ' +
                 'checkout.session.async_payment_succeeded and ' +
                 'checkout.session.async_payment_failed');
  }
  process.exitCode = failed ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
