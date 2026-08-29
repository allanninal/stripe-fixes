/**
 * Report Stripe manual-capture authorizations about to expire, or already lost.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to PaymentIntents and Charges. The repair is printed, never
 * performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Sort one PaymentIntent by how much of its authorization window is left. Pure,
 * and `now` is passed in rather than read, so two hours left, an hour past, and
 * no deadline at all are all testable. The deadline is capture_before on the
 * charge, never created plus a fixed number of days. Returns [state, detail].
 */
export function classify(intent, now, warnSeconds = 48 * 3600) {
  if (intent.capture_method !== 'manual') {
    return ['automatic', 'captured automatically, no hold to lose'];
  }

  const status = intent.status;

  if (status === 'succeeded') return ['captured', 'captured inside the window'];

  if (status === 'canceled') {
    if (intent.cancellation_reason === 'automatic') {
      return ['lost',
        'the authorization expired uncaptured: Stripe canceled it, the hold was ' +
        'released, and no capture can take the money now'];
    }
    return ['canceled',
      `canceled deliberately (${intent.cancellation_reason ?? 'no reason recorded'})`];
  }

  if (status !== 'requires_capture') {
    return ['open', `status ${status}: nothing is authorised yet`];
  }

  const charge = intent.latest_charge;
  if (!charge || typeof charge !== 'object') {
    return ['unknown',
      'requires_capture with no expanded charge: add expand[]=data.latest_charge, ' +
      'and do not assume seven days'];
  }

  const card = (charge.payment_method_details ?? {}).card ?? {};
  const captureBefore = card.capture_before;
  if (!captureBefore) {
    return ['unknown',
      'requires_capture with no capture_before on the charge: the deadline is ' +
      'unknown, which is not the same as far away'];
  }

  const left = Number(captureBefore) - Number(now);
  if (left <= 0) {
    return ['expired',
      `capture_before passed ${Math.floor(-left / 3600)}h ago: the hold is gone ` +
      'even if the status has not caught up'];
  }
  if (left <= warnSeconds) {
    return ['expiring',
      `${Math.floor(left / 3600)}h left to capture: past that the funds are ` +
      'released to the cardholder'];
  }
  return ['held', `${Math.floor(left / 3600)}h left to capture`];
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

export async function* intents(key, since, cap = 20000) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since,
                   'expand[]': 'data.latest_charge' };
  for (;;) {
    const page = await get(key, '/payment_intents', params);
    const data = page.data ?? [];
    for (const pi of data) {
      yield pi;
      seen += 1;
      if (seen >= cap) return;
    }
    if (data.length === 0 || !page.has_more) return;
    params.starting_after = data[data.length - 1].id;
  }
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const days = Number((process.env.DAYS || "dummy-days") ?? 30);
  const warnHours = Number((process.env.WARN_HOURS || "dummy-warn-hours") ?? 48);

  const counts = {};
  let manual = 0;
  let lostAmount = 0;
  const urgent = [];

  for await (const pi of intents(key, now - days * 86400)) {
    const [state, detail] = classify(pi, now, warnHours * 3600);
    if (state === 'automatic') continue;
    manual += 1;
    counts[state] = (counts[state] ?? 0) + 1;
    if (state === 'lost') lostAmount += pi.amount ?? 0;
    if (state === 'expiring' || state === 'expired' || state === 'unknown') {
      urgent.push([pi, state, detail]);
    }
  }

  // Soonest deadline first: age is the wrong sort key, because two intents
  // created the same minute can have very different windows.
  const deadline = ([pi]) =>
    (((pi.latest_charge ?? {}).payment_method_details ?? {}).card ?? {})
      .capture_before ?? 0;

  for (const [pi, state, detail] of urgent.sort((a, b) => deadline(a) - deadline(b))) {
    console.warn(`${pi.id ?? 'pi_?'}  ${state.padEnd(9)} ${detail}`);
  }

  const expiring = (counts.expiring ?? 0) + (counts.expired ?? 0);
  console.log(`${manual} manual-capture intent(s): ${counts.captured ?? 0} ` +
              `captured, ${counts.held ?? 0} held, ${expiring} expiring, ` +
              `${counts.lost ?? 0} lost`);

  if (expiring) {
    console.warn('  repair: capture now, oldest deadline first:');
    console.warn(`  POST ${API}/payment_intents/{id}/capture`);
  }
  if (counts.lost) {
    console.warn(`  ${counts.lost} authorization(s) already expired, ${lostAmount} ` +
                 'minor unit(s) never collected. Each one also produced a refund ' +
                 'with reason expired_uncaptured_charge.');
    console.warn('  repair: drive the capture job from capture_before rather than ' +
                 'a fixed delay, or request extended authorization, or let Stripe ' +
                 'capture near expiry.');
  }
  if (expiring || counts.lost || counts.unknown) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
