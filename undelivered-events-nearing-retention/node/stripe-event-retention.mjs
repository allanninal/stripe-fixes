/**
 * Report undelivered Stripe events approaching the 30-day retention cliff.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Events. The replay is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const RETENTION_DAYS = 30; // events leave /v1/events entirely at this age
const CRITICAL_DAYS = 29;         // gone tomorrow
const WARN_DAYS = 20;             // still replayable, but schedule it now

/**
 * Classify the backlog. Pure, so the boundaries can be tested without a network.
 * `oldestAgeDays` is null when nothing is undelivered.
 */
export function verdict(oldestAgeDays, count) {
  if (!count) return ['clear', '0 undelivered event(s) in the retained window'];
  if (oldestAgeDays === null || oldestAgeDays === undefined) {
    return ['unknown', `${count} undelivered event(s) but no usable created timestamp`];
  }
  const left = RETENTION_DAYS - oldestAgeDays;
  if (oldestAgeDays >= CRITICAL_DAYS) {
    return ['expiring',
      `${count} event(s); the oldest is ${oldestAgeDays.toFixed(1)} days old and ` +
      'leaves the API in under a day. Replay oldest first, now.'];
  }
  if (oldestAgeDays >= WARN_DAYS) {
    return ['aging',
      `${count} event(s); the oldest expires in ${left.toFixed(1)} days. ` +
      'Schedule the replay rather than discussing it.'];
  }
  return ['replayable',
    `${count} event(s); the oldest expires in ${left.toFixed(1)} days. ` +
    'There is room to replay carefully.'];
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

export async function undelivered(key, limit = 5000) {
  let count = 0;
  let oldest = null;
  let oldestId = null;
  const params = { delivery_success: 'false', limit: 100 };
  for (;;) {
    const page = await get(key, '/events', params);
    const data = page.data ?? [];
    for (const ev of data) {
      count += 1;
      if (ev.created !== undefined && (oldest === null || ev.created < oldest)) {
        oldest = ev.created;
        oldestId = ev.id;
      }
    }
    if (data.length === 0 || !page.has_more || count >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { count, oldest, oldestId };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const { count, oldest, oldestId } = await undelivered(key);
  const age = oldest === null ? null : (Date.now() / 1000 - oldest) / 86400;
  const [state, detail] = verdict(age, count);

  const line = `${state.padEnd(11)} ${detail}`;
  if (state === 'clear') { console.log(line); return; }

  console.warn(line);
  console.warn('  replay oldest first, walking backwards from the tail:');
  console.warn(`  GET ${API}/events?delivery_success=false&ending_before=${oldestId ?? '<evt_id>'}`);
  if (state === 'expiring') {
    console.warn(`  anything already past ${RETENTION_DAYS} days: reconcile from the ` +
                 'objects instead, which have no retention limit:');
    console.warn(`  GET ${API}/charges?created[gte]=<unix>   GET ${API}/invoices?created[gte]=<unix>`);
  }
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
