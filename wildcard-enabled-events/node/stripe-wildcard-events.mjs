/**
 * Report Stripe webhook endpoints subscribed to far more events than they handle.
 *
 * Read only. Two GETs, no writes: give this a RESTRICTED key with read access to
 * Webhook Endpoints and Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Above this an explicit list is a wildcard somebody typed out by hand.
const WIDE = 40;

/**
 * Classify one endpoint's subscription. Pure, so the rules can be tested.
 * `firedTypes` is the set of event types actually seen in the retained window.
 */
export function verdict(enabledEvents, firedTypes) {
  const events = [...(enabledEvents ?? [])];
  const fired = new Set(firedTypes ?? []);
  if (events.length === 0) {
    return ['empty', 'no enabled_events at all: this endpoint receives nothing'];
  }
  if (events.includes('*')) {
    return ['wildcard',
      `subscribed to every event type. ${fired.size} distinct type(s) fired in ` +
      'the retained window, and all of them are being delivered.'];
  }
  if (events.length > WIDE) {
    return ['overbroad',
      `${events.length} explicit types subscribed. That is a wildcard written ` +
      'out by hand and carries the same load.'];
  }
  const distinct = new Set(events);
  const unused = [...distinct].filter((e) => !fired.has(e)).sort();
  if (unused.length > 0) {
    return ['padded',
      `${unused.length} of ${distinct.size} subscribed type(s) never fired in ` +
      `the retained window: ${unused.slice(0, 5).join(', ')}`];
  }
  return ['focused', `${distinct.size} type(s), all seen firing`];
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

export async function firedTypes(key, limit = 2000) {
  const counts = new Map();
  let total = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/events', params);
    const data = page.data ?? [];
    for (const ev of data) {
      total += 1;
      counts.set(ev.type, (counts.get(ev.type) ?? 0) + 1);
    }
    if (data.length === 0 || !page.has_more || total >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return counts;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const { data: endpoints = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  if (endpoints.length === 0) {
    console.log("no webhook endpoints configured for this key's mode");
    return;
  }

  const counts = await firedTypes(key);
  const sampled = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`sampled ${sampled} event(s) across ${counts.size} distinct type(s)`);

  let bad = 0;
  for (const ep of endpoints) {
    const [state, detail] = verdict(ep.enabled_events, counts.keys());
    const line = `${state.padEnd(10)} ${ep.url ?? '?'}  ${detail}`;
    if (state === 'focused') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.warn(`  busiest types seen: ${top.map(([t, n]) => `${t} x${n}`).join(', ')}`);
    console.warn(`  repair: POST ${API}/webhook_endpoints/${ep.id} ` +
                 '-d enabled_events[]=<type> ... (one per branch in your handler)');
  }

  console.log(`${endpoints.length} endpoint(s), ${bad} needing attention`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
