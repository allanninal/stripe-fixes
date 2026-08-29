/**
 * Report Stripe cards saved with usage=on_session but billed off-session.
 *
 * Read only. Three paginated GETs, no writes: give this a RESTRICTED key with
 * read access to SetupIntents, PaymentIntents and Subscriptions. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify the account. Pure, so the ordering can be tested without a network.
 *
 * The decline count is deliberately checked second, not first: authentication
 * failures with no on_session save behind them are a different bug.
 */
export function verdict(succeeded, onSession, onSessionSubscribed, authRequired) {
  if (!succeeded) {
    return ['unknown', 'no succeeded SetupIntents in the window; nothing to judge'];
  }
  if (onSessionSubscribed && authRequired) {
    return ['declining',
      `${onSessionSubscribed} card(s) saved on_session belong to subscribed ` +
      `customers, and ${authRequired} off-session charge(s) have already failed ` +
      'on authentication_required.'];
  }
  if (onSessionSubscribed) {
    return ['exposed',
      `${onSessionSubscribed} card(s) saved on_session belong to customers with ` +
      'an active subscription. Nothing has failed yet; the next renewal is the test.'];
  }
  if (onSession) {
    return ['review',
      `${onSession} of ${succeeded} saved card(s) used usage=on_session, none of ` +
      'them for a subscribed customer. Correct only if you never charge without ' +
      'the customer present.'];
  }
  if (authRequired) {
    return ['elsewhere',
      `${authRequired} off-session decline(s) on authentication_required, but ` +
      'every saved card is off_session. The mandate is not the cause; look at ' +
      'the charge path.'];
  }
  return ['clear',
    `${succeeded} saved card(s), all off_session, 0 authentication_required decline(s)`];
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

async function* pageAll(key, path, limit, params = {}) {
  let seen = 0;
  const p = { ...params, limit: 100 };
  for (;;) {
    const page = await get(key, path, p);
    const data = page.data ?? [];
    for (const obj of data) { yield obj; seen += 1; }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
    p.starting_after = data[data.length - 1].id;
  }
}

async function subscribedCustomerIds(key, limit = 2000) {
  const ids = new Set();
  for await (const sub of pageAll(key, '/subscriptions', limit, { status: 'active' })) {
    const cus = typeof sub.customer === 'object' ? sub.customer?.id : sub.customer;
    if (cus) ids.add(cus);
  }
  return ids;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = 180;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const subscribed = await subscribedCustomerIds(key);

  let succeeded = 0;
  let onSession = 0;
  let onSessionSubscribed = 0;
  const offenders = [];
  for await (const si of pageAll(key, '/setup_intents', 5000, { 'created[gte]': since })) {
    if (si.status !== 'succeeded') continue;
    succeeded += 1;
    if (si.usage !== 'on_session') continue;
    onSession += 1;
    const cus = typeof si.customer === 'object' ? si.customer?.id : si.customer;
    if (subscribed.has(cus)) {
      onSessionSubscribed += 1;
      if (offenders.length < 10) offenders.push([si.id, cus, si.mandate]);
    }
  }

  let piOnSession = 0;
  let authRequired = 0;
  for await (const pi of pageAll(key, '/payment_intents', 5000, { 'created[gte]': since })) {
    if (pi.setup_future_usage === 'on_session') piOnSession += 1;
    if (pi.last_payment_error?.decline_code === 'authentication_required') authRequired += 1;
  }

  const [state, detail] = verdict(succeeded, onSession + piOnSession,
    onSessionSubscribed, authRequired);

  const line = `${state.padEnd(11)} ${detail}`;
  if (state === 'clear' || state === 'unknown') { console.log(line); return; }

  console.warn(line);
  console.warn(`  ${onSession} SetupIntent(s) and ${piOnSession} PaymentIntent(s) recorded on_session`);
  for (const [id, cus, mandate] of offenders) {
    console.warn(`  ${id}  customer=${cus}  mandate=${mandate}`);
  }
  console.warn('  repair: collect fresh consent, then save with the right usage');
  console.warn(`  POST ${API}/setup_intents -d customer=cus_XXX -d usage=off_session`);
  console.warn('  when saving during a payment: -d setup_future_usage=off_session');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
