/**
 * Report Stripe webhook subscriptions to event types that are dead or rejected.
 *
 * Read only. Two GETs and no writes: give this a RESTRICTED key with read
 * access to Webhook Endpoints and Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// The Sources API families. These stay configurable but stop occurring once the
// integration moves to PaymentIntents and PaymentMethods.
const LEGACY_PREFIXES = ['source.', 'customer.source.'];

// Types the API no longer accepts on an update, so one of these poisons every
// future change to the endpoint.
export const REJECTED = new Set(['invoiceitem.updated']);

/**
 * Classify one subscribed event type. Pure, so the rules can be tested.
 * `fired` is the set of event types actually seen in the retained window.
 */
export function verdict(eventType, fired) {
  if (eventType === '*') {
    return ['wildcard', 'subscribed to every type: there is no list here to diff'];
  }
  const seen = new Set(fired ?? []);
  if (REJECTED.has(eventType)) {
    return ['rejected',
      'the API no longer accepts this type. The next update to this endpoint ' +
      'fails on it, whatever the update was for.'];
  }
  if (LEGACY_PREFIXES.some((p) => eventType.startsWith(p))) {
    if (seen.has(eventType)) {
      return ['legacy',
        'a Sources API type that is still firing: something in the integration ' +
        'still creates Sources'];
    }
    return ['dead',
      'a Sources API type with no occurrences in the retained window. It does ' +
      'not fire for a PaymentMethod integration, so any handler branch behind ' +
      'it is dead code.'];
  }
  if (seen.has(eventType)) return ['live', 'seen firing in the retained window'];
  return ['quiet',
    'no occurrences in the retained window. That is low volume, not proof of ' +
    'decay: disputes and failures are supposed to be rare.'];
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

export async function firedTypes(key, limit = 5000) {
  const seen = new Set();
  let total = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/events', params);
    const data = page.data ?? [];
    for (const ev of data) { total += 1; seen.add(ev.type); }
    if (data.length === 0 || !page.has_more || total >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { seen, total };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const { data: eps = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  if (eps.length === 0) {
    console.log("no webhook endpoints configured for this key's mode");
    return;
  }

  const { seen, total } = await firedTypes(key);
  console.log(`sampled ${total} event(s) across ${seen.size} distinct type(s)`);

  let bad = 0;
  for (const ep of eps) {
    const keep = [];
    const drop = [];
    for (const t of ep.enabled_events ?? []) {
      const [state, detail] = verdict(t, seen);
      const line = `${state.padEnd(9)} ${t.padEnd(32)} ${detail}`;
      if (state === 'dead' || state === 'rejected') {
        bad += 1;
        drop.push(t);
        console.warn(`${ep.url ?? '?'}  ${line}`);
      } else {
        keep.push(t);
        console.log(`${ep.url ?? '?'}  ${line}`);
      }
    }
    if (drop.length) {
      console.warn('  enabled_events is replaced wholesale on update, so ' +
                   're-send the full corrected list:');
      const args = keep.slice(0, 6).map((t) => `-d enabled_events[]=${t}`).join(' ');
      console.warn(`  repair: POST ${API}/webhook_endpoints/${ep.id} ${args}` +
                   (keep.length > 6 ? ' ...' : ''));
      console.warn(`  dropping: ${drop.join(', ')}`);
    }
  }

  console.log(`${eps.length} endpoint(s), ${bad} dead or rejected subscription(s)`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
