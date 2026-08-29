/**
 * Report Stripe events whose deliveries are still outstanding hours after they fired.
 *
 * Read only. One paginated GET, no writes: give this a RESTRICTED key with read
 * access to Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const GRACE_SECONDS = 3600;
const CONCENTRATED = 0.8;
const WIDESPREAD = 0.5;

/**
 * Classify a window of events. Pure, so the rules can be tested offline.
 */
export function verdict(sampled, stuck, topType, topCount) {
  if (sampled <= 0) {
    return ['empty',
      'no events older than the grace period in the retained window: nothing ' +
      'here can be judged yet'];
  }
  if (stuck <= 0) {
    return ['clear', `${sampled} event(s) older than the grace period, all delivered`];
  }
  const share = topCount / stuck;
  if (share >= CONCENTRATED) {
    return ['one-branch',
      `${topCount} of ${stuck} stuck event(s) are ${topType}. That is one ` +
      'handler branch failing, not the endpoint.'];
  }
  if (stuck / sampled >= WIDESPREAD) {
    return ['endpoint-wide',
      `${stuck} of ${sampled} sampled event(s) never got a 2xx, across ` +
      `${topType} and other types. The route is timing out or answering with a ` +
      'redirect.'];
  }
  return ['intermittent',
    `${stuck} of ${sampled} sampled event(s) stuck, spread across types. This is ` +
    'the handler running out of time under load rather than one bad branch.'];
}

async function get(key, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (res.status === 403) {
    throw new Error(`403 from Stripe: the restricted key lacks read access to ${path}`);
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export async function scan(key, cutoff, limit = 1000) {
  let sampled = 0;
  let stuck = 0;
  const byType = new Map();
  const params = { limit: 100, 'created[lt]': cutoff };
  for (;;) {
    const page = await get(key, '/events', params);
    const data = page.data ?? [];
    for (const ev of data) {
      sampled += 1;
      if ((ev.pending_webhooks ?? 0) > 0) {
        stuck += 1;
        const t = ev.type ?? 'unknown';
        byType.set(t, (byType.get(t) ?? 0) + 1);
      }
    }
    if (data.length === 0 || !page.has_more || sampled >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { sampled, stuck, byType };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const cutoff = Math.floor(Date.now() / 1000) - GRACE_SECONDS;
  const { sampled, stuck, byType } = await scan(key, cutoff);

  // Sorted by count then name so a tie reports the same type on every run.
  const ranked = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [topType, topCount] = ranked[0] ?? ['none', 0];

  const [state, detail] = verdict(sampled, stuck, topType, topCount);
  if (state === 'empty' || state === 'clear') {
    console.log(`${state.padEnd(13)} ${detail}`);
    return;
  }

  console.warn(`${state.padEnd(13)} ${detail}`);
  for (const [t, n] of ranked.slice(0, 8)) {
    console.warn(`  ${String(n).padStart(5)}  ${t}`);
  }
  console.warn('  repair: return 200 as soon as the signature verifies and move ' +
               'the work to a queue. A slow 200 is a failed delivery.');
  console.warn(`  then replay: GET ${API}/events?delivery_success=false paginated ` +
               'oldest first, guarded by your processed event table');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
