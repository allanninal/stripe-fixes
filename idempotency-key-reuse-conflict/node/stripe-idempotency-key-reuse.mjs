/**
 * Report Stripe idempotency keys reused across more than one request.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Events. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Stripe prunes saved idempotency results after roughly 24 hours. A key seen
// either side of that gap was not replayed; it started a new operation.
export const PRUNE_WINDOW = 86400;
const MAX_KEY_LEN = 255;

const OBJECT_ID = /^(cus_|pi_|ch_|sub_|in_|seti_|user[-_])/i;
const UUID4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * What a key string is built out of. Pure. Returns [shape, description].
 * Anything but 'uuid' and 'opaque' is derived from something that comes round
 * again, whether or not it has collided yet.
 */
export function keyShape(key) {
  if (key === null || key === undefined || key === '') {
    return ['missing', 'no key at all'];
  }
  const k = String(key);
  if (k.length > MAX_KEY_LEN) {
    return ['over-long', `${k.length} characters, over the ${MAX_KEY_LEN} limit`];
  }
  if (k.includes('@')) {
    return ['personal',
      'an email address, which repeats and should not be sent as a key'];
  }
  if (UUID4.test(k)) return ['uuid', 'a v4 uuid'];
  if (OBJECT_ID.test(k)) {
    return ['object-id',
      'an object id, which repeats every time that object is used again'];
  }
  if (/^\d+$/.test(k)) return ['integer', 'a bare integer, which repeats'];
  if (ISO_DATE.test(k)) {
    return ['date', 'a date, which repeats for every operation that day'];
  }
  return ['opaque', 'not obviously derived from anything that repeats'];
}

/**
 * Classify one key's tally. Pure, so the thresholds can be tested.
 * `requestIds` is the number of distinct request ids carrying this key.
 */
export function verdict(key, requestIds, spreadSeconds) {
  const [shape, described] = keyShape(key);
  if (requestIds > 1 && spreadSeconds > PRUNE_WINDOW) {
    return ['pruned',
      `${requestIds} distinct requests, ${spreadSeconds} seconds apart. Stripe ` +
      `forgets a key after about ${PRUNE_WINDOW} seconds, so the later one ` +
      'started a fresh operation and created a duplicate rather than replaying.'];
  }
  if (requestIds > 1) {
    return ['concurrent',
      `${requestIds} distinct requests inside the window Stripe remembers the ` +
      'key. Both executed, so the key is shared between operations rather than ' +
      'unique to one. Under load this returns 409 idempotency_key_in_use.'];
  }
  if (shape !== 'uuid' && shape !== 'opaque') {
    return ['derived', `one request so far, but the key is ${described}`];
  }
  return ['unique', `one request, and the key is ${described}`];
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

export async function keysSeen(key, since, limit = 5000) {
  const seen = new Map();
  let total = 0;
  const params = { limit: 100, 'created[gte]': Math.floor(since) };
  for (;;) {
    const page = await get(key, '/events', params);
    const data = page.data ?? [];
    for (const ev of data) {
      total += 1;
      const req = ev.request;
      if (!req || typeof req !== 'object') continue;
      const idem = req.idempotency_key;
      if (!idem) continue; // unkeyed requests are a different problem
      if (!seen.has(idem)) seen.set(idem, { ids: new Set(), first: null, last: null });
      const row = seen.get(idem);
      if (req.id) row.ids.add(req.id);
      const created = ev.created;
      if (created !== null && created !== undefined) {
        row.first = row.first === null ? created : Math.min(row.first, created);
        row.last = row.last === null ? created : Math.max(row.last, created);
      }
    }
    if (data.length === 0 || !page.has_more || total >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { seen, total };
}

async function main() {
  const apiKey = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!apiKey) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number((process.env.DAYS || "dummy-days") ?? 30);
  const since = Date.now() / 1000 - days * 86400;
  const { seen, total } = await keysSeen(apiKey, since);
  console.log(`sampled ${total} event(s) over ${days} day(s)`);

  let reused = 0;
  let derived = 0;
  for (const k of [...seen.keys()].sort()) {
    const row = seen.get(k);
    const spread = (row.last ?? 0) - (row.first ?? 0);
    const [state, detail] = verdict(k, row.ids.size || 1, spread);
    if (state === 'unique') continue;
    const line = `${state.padEnd(11)} ${k.slice(0, 40).padEnd(40)} ${detail}`;
    if (state === 'derived') { derived += 1; console.log(line); }
    else { reused += 1; console.warn(line); }
  }

  if (reused || derived) {
    console.warn('  repair: one fresh v4 uuid per logical operation, made when ' +
                 'the operation is first attempted');
    console.warn('  persist it next to the operation record and resend it ' +
                 'unchanged for every retry of that exact request');
    console.warn('  on 409 idempotency_key_in_use, back off and retry with the ' +
                 'same key rather than minting a new one');
    console.warn('  never derive a key from a customer id, an order id, a date ' +
                 `or an email address; keys cap at ${MAX_KEY_LEN} characters`);
  }
  console.log(`${seen.size} key(s) sampled, ${reused} reused, ${derived} derived ` +
              'from something that repeats');
  process.exitCode = reused ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
