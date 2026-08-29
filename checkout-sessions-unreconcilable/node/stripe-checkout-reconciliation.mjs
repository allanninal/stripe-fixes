/**
 * Report Stripe Checkout Sessions that carry no identifier of your own.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Checkout Sessions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const DEFAULT_KEYS = ['order_id'];

/**
 * Classify one Checkout Session. Pure, so the rules can be tested offline.
 * `expectedKeys` are the metadata keys your own system reads.
 */
export function verdict(session, expectedKeys = DEFAULT_KEYS) {
  const ref = String(session.client_reference_id ?? '').trim();
  const meta = session.metadata ?? {};
  const present = expectedKeys.filter((k) => String(meta[k] ?? '').trim());

  if (ref) return ['linked', `client_reference_id=${ref}`];
  if (expectedKeys.length && present.length === expectedKeys.length) {
    return ['linked', `metadata carries ${present.join(', ')}`];
  }
  if (present.length) {
    const missing = expectedKeys.filter((k) => !present.includes(k));
    return ['partial',
      `metadata has ${present.join(', ')} but is missing ${missing.join(', ')}`];
  }
  if (session.payment_status === 'paid') {
    return ['orphaned',
      `paid, with no client_reference_id and none of ${expectedKeys.join(', ')} ` +
      'in metadata: money that points at nothing'];
  }
  return ['unlinked',
    'no identifier of yours, but payment_status is ' +
    `${JSON.stringify(session.payment_status)} so nothing has been taken yet`];
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

export async function* sessions(key, since, limit = 5000) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': Math.floor(since) };
  for (;;) {
    const page = await get(key, '/checkout/sessions', params);
    const data = page.data ?? [];
    for (const s of data) { yield s; seen += 1; }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
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

  const days = Number(process.argv[2] ?? 30);
  const expected = (process.argv[3] ?? DEFAULT_KEYS.join(','))
    .split(',').map((k) => k.trim()).filter(Boolean);

  const counts = { linked: 0, partial: 0, unlinked: 0, orphaned: 0 };
  const worst = [];
  let total = 0;

  for await (const s of sessions(key, Date.now() / 1000 - days * 86400)) {
    total += 1;
    const [state, detail] = verdict(s, expected);
    counts[state] = (counts[state] ?? 0) + 1;
    if (state === 'orphaned' && worst.length < 10) worst.push([s.id ?? '?', detail]);
  }

  console.log(`${total} session(s): ${counts.linked} linked, ${counts.partial} ` +
              `partial, ${counts.unlinked} unlinked, ${counts.orphaned} orphaned`);
  for (const [id, detail] of worst) console.warn(`orphaned  ${id}  ${detail}`);

  if (counts.orphaned || counts.partial) {
    console.warn(`  repair: POST ${API}/checkout/sessions ` +
                 `-d client_reference_id=<your_order_id> ` +
                 `-d 'metadata[order_id]=<your_order_id>'`);
    console.warn('  for Payment Links, set metadata on the link itself: it is ' +
                 'copied onto every Session the link creates');
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
