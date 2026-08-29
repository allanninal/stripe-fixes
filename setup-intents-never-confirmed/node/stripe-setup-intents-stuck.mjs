/**
 * Report Stripe SetupIntents that were created and never confirmed.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to SetupIntents. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const STUCK_STATUSES = [
  'requires_payment_method', 'requires_confirmation', 'requires_action',
];
const BROKEN_RATIO = 0.20; // above this it is the confirm path, not abandonment
const MIN_AGE_HOURS = 24;  // younger than this is a customer still typing

/**
 * Classify a window of SetupIntents. Pure, so it can be tested offline.
 *
 * Ties are broken in a fixed order rather than by whichever bucket an object
 * happened to yield first: requiresAction wins, then requiresConfirmation. Both
 * are specific code defects, while requiresPaymentMethod is the bucket ordinary
 * abandonment also lands in, so it should never win a tie.
 */
export function verdict(total, requiresPaymentMethod, requiresConfirmation, requiresAction) {
  const stuck = requiresPaymentMethod + requiresConfirmation + requiresAction;
  if (!total) return ['clear', 'no SetupIntents created in the window'];
  if (!stuck) return ['clear', `all ${total} SetupIntent(s) in the window resolved`];
  const ratio = stuck / total;
  const pct = (ratio * 100).toFixed(0);
  if (ratio < BROKEN_RATIO) {
    return ['abandonment',
      `${stuck} of ${total} SetupIntents (${pct}%) are stuck, under the ` +
      `${(BROKEN_RATIO * 100).toFixed(0)}% that separates a broken confirm path ` +
      'from ordinary drop-off'];
  }
  if (requiresAction >= requiresConfirmation && requiresAction >= requiresPaymentMethod) {
    return ['return-url',
      `${stuck} of ${total} (${pct}%) stuck, mostly at requires_action: the 3DS ` +
      'handoff starts and never comes back. Check next_action.type and the ' +
      'return_url landing page.'];
  }
  if (requiresConfirmation >= requiresPaymentMethod) {
    return ['unconfirmed',
      `${stuck} of ${total} (${pct}%) stuck, mostly at requires_confirmation: ` +
      'confirmSetup() is never being called for these.'];
  }
  return ['no-payment-method',
    `${stuck} of ${total} (${pct}%) stuck at requires_payment_method, above the ` +
    'abandonment threshold: read last_setup_error.code before blaming the customers.'];
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

  const cutoff = Math.floor(Date.now() / 1000 - MIN_AGE_HOURS * 3600);
  const buckets = Object.fromEntries(STUCK_STATUSES.map((s) => [s, 0]));
  const errors = new Map();
  const nextActions = new Map();
  let total = 0;

  for (const si of await pageAll(key, '/setup_intents', 2000, { 'created[lt]': cutoff })) {
    total += 1;
    if (!(si.status in buckets)) continue;
    buckets[si.status] += 1;
    const err = si.last_setup_error?.code;
    if (err) errors.set(err, (errors.get(err) ?? 0) + 1);
    const action = si.next_action?.type;
    if (action) nextActions.set(action, (nextActions.get(action) ?? 0) + 1);
  }

  const [state, detail] = verdict(total, buckets.requires_payment_method,
    buckets.requires_confirmation, buckets.requires_action);
  const line = `${state.padEnd(18)} ${detail}`;
  if (state === 'clear') { console.log(line); return; }

  console.warn(line);
  for (const status of STUCK_STATUSES) {
    console.warn(`  ${status.padEnd(24)} ${buckets[status]}`);
  }
  for (const [code, count] of [...errors].sort((a, b) => b[1] - a[1])) {
    console.warn(`  last_setup_error ${code.padEnd(20)} ${count}`);
  }
  for (const [action, count] of [...nextActions].sort((a, b) => b[1] - a[1])) {
    console.warn(`  next_action ${action.padEnd(25)} ${count}`);
  }
  console.warn("  confirm on the client and treat only 'succeeded' as success:");
  console.warn('  await stripe.confirmSetup({elements, confirmParams: {return_url}})');
  console.warn('  persist from the setup_intent.succeeded webhook, not the browser');
  console.warn(`  clear the backlog: POST ${API}/setup_intents/{id}/cancel -d cancellation_reason=abandoned`);
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
