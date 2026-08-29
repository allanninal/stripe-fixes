/**
 * Report Stripe customers whose address cannot satisfy Tax, AVS or SCA.
 *
 * Read only. Paginated GETs and one search, no writes: give this a RESTRICTED
 * key with read access to Customers, Subscriptions and Invoices. The repair is
 * printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Share of incomplete addresses that means the collection path is wrong.
export const WIDESPREAD = 0.25;

/**
 * Classify one customer's address. Pure, so it can be tested without a network.
 * Returns 'missing', 'no_country', 'no_postal_code' or 'complete'.
 *
 * Stripe returns `address` either as null or as an object whose fields are
 * individually null. An object with nothing in it is an absent address, not a
 * partial one.
 */
export function addressState(customer) {
  const addr = customer.address;
  if (!addr || typeof addr !== 'object') return 'missing';
  if (!Object.values(addr).some((v) => v)) return 'missing';
  if (!addr.country) return 'no_country';
  if (!addr.postal_code) return 'no_postal_code';
  return 'complete';
}

/**
 * Roll the counts up into one state. Pure.
 * An invoice that has already refused to finalize outranks any percentage.
 */
export function verdict(total, incomplete, subscribedIncomplete, taxFailures) {
  if (!total) {
    return ['unknown', 'no customers read; check the key and the mode it belongs to'];
  }
  if (taxFailures) {
    return ['failing',
      `${taxFailures} invoice(s) already refused to finalize with ` +
      'customer_tax_location_invalid. This is not a risk, it is unsent revenue.'];
  }
  if (subscribedIncomplete) {
    return ['billing',
      `${subscribedIncomplete} subscribed customer(s) have an incomplete address. ` +
      'Each renewal is a finalization that can fail.'];
  }
  const share = incomplete / total;
  if (share >= WIDESPREAD) {
    return ['widespread',
      `${incomplete} of ${total} customer(s), ${Math.round(share * 100)}%, have an ` +
      'incomplete address. At that share the collection path is wrong, not the data.'];
  }
  if (incomplete) {
    return ['residue',
      `${incomplete} of ${total} customer(s) have an incomplete address. Backfill ` +
      'them and close the collection hole.'];
  }
  return ['clear', `${total} customer(s), 0 with an incomplete address`];
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

async function taxFailureCount(key) {
  try {
    const page = await get(key, '/invoices/search', {
      query: "last_finalization_error_code:'customer_tax_location_invalid'",
      limit: 100,
    });
    return (page.data ?? []).length;
  } catch (err) {
    console.log(`invoice search unavailable (${err.message}); skipping the confirmation step`);
    return 0;
  }
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const buckets = { missing: 0, no_country: 0, no_postal_code: 0, complete: 0 };
  const examples = new Map();
  let total = 0;
  for await (const cus of pageAll(key, '/customers', 5000)) {
    const state = addressState(cus);
    buckets[state] += 1;
    total += 1;
    if (state !== 'complete' && !examples.has(state)) examples.set(state, cus.id);
  }

  let subscribedIncomplete = 0;
  for await (const sub of pageAll(key, '/subscriptions', 1000,
    { status: 'active', 'expand[]': 'data.customer' })) {
    const cus = sub.customer;
    if (cus && typeof cus === 'object' && addressState(cus) !== 'complete') {
      subscribedIncomplete += 1;
    }
  }

  const incomplete = total - buckets.complete;
  const [state, detail] = verdict(total, incomplete, subscribedIncomplete,
    await taxFailureCount(key));

  const line = `${state.padEnd(11)} ${detail}`;
  if (state === 'clear' || state === 'unknown') { console.log(line); return; }

  console.warn(line);
  console.warn(`  ${buckets.missing} absent, ${buckets.no_country} without a country, ` +
               `${buckets.no_postal_code} without a postal code`);
  for (const [bucket, id] of [...examples].sort()) {
    console.warn(`  example ${bucket.padEnd(14)} ${id}`);
  }
  console.warn('  repair one customer:');
  console.warn(`  POST ${API}/customers/{id} -d "address[line1]=..." ` +
               '-d "address[city]=..." -d "address[postal_code]=..." -d "address[country]=US"');
  console.warn('  stop creating more: set billing_address_collection=required on ' +
               'Checkout Sessions, or collect billing details in the Payment Element');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
