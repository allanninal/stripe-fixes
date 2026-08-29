/**
 * Report Stripe Customers that share an email address.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Customers, Subscriptions and PaymentMethods. The merge is printed,
 * never performed, because deleting a customer cancels its subscriptions.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Lowercase and trim an address for grouping. Pure.
 *
 * Stripe's own email filter is exact and case-sensitive, so grouping has to
 * normalise even though the confirming API call cannot.
 */
export function normalise(email) {
  if (!email) return null;
  return String(email).trim().toLowerCase() || null;
}

/**
 * Classify one group of customers sharing an address. Pure.
 * Each record is { id, has_card, has_subscription }, filled in by the caller.
 */
export function verdict(records) {
  const n = records.length;
  if (n <= 1) return ['unique', 'one customer for this address'];

  const subs = records.filter((r) => r.has_subscription);
  const holders = records.filter((r) => r.has_card || r.has_subscription);

  if (subs.length > 1) {
    return ['split_billing',
      `${n} records, ${subs.length} with a subscription. They renew ` +
      'independently, so cancelling one leaves the other charging.'];
  }
  if (holders.length > 1) {
    return ['split_methods',
      `${n} records, ${holders.length} holding a card or a subscription. ` +
      'Support will answer from whichever one they find first.'];
  }
  if (holders.length) {
    return ['shells',
      `${n} records, one holding everything. The other ${n - 1} are empty.`];
  }
  return ['empty',
    `${n} records, none holding a card or a subscription. Untidy, not urgent.`];
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

export async function groupByEmail(key, limit = 10000) {
  const groups = new Map();
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/customers', params);
    const data = page.data ?? [];
    for (const c of data) {
      seen += 1;
      const email = normalise(c.email);
      if (email === null) continue; // no email is a different problem
      groups.set(email, [...(groups.get(email) ?? []), c.id]);
    }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { groups, seen };
}

async function enrich(key, customerId) {
  const cards = await get(key, '/payment_methods',
    { customer: customerId, type: 'card', limit: 1 });
  const subs = await get(key, '/subscriptions',
    { customer: customerId, status: 'all', limit: 1 });
  return {
    id: customerId,
    has_card: Boolean((cards.data ?? []).length),
    has_subscription: Boolean((subs.data ?? []).length),
  };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const maxGroups = Number(process.argv[2] ?? 50);
  const { groups, seen } = await groupByEmail(key);
  const dupes = [...groups.entries()].filter(([, ids]) => ids.length > 1);

  console.log(`${seen} customer(s), ${dupes.length} address(es) with more than one record`);
  if (dupes.length === 0) return;

  // Worst first: the ones with the most records are the ones support is
  // already losing time to.
  dupes.sort((a, b) => b[1].length - a[1].length);
  let bad = 0;
  for (const [email, ids] of dupes.slice(0, maxGroups)) {
    const records = [];
    for (const id of ids) records.push(await enrich(key, id));
    const [state, detail] = verdict(records);
    console.warn(`${state.padEnd(14)} ${email}  ${detail}`);
    console.warn(`  records: ${records.map((r) => r.id).join(', ')}`);
    if (state === 'split_billing' || state === 'split_methods') {
      bad += 1;
      console.warn(`  merge: POST ${API}/payment_methods/<pm>/attach ` +
                   `-d customer=${records[0].id}, move the subscriptions, then ` +
                   `DELETE ${API}/customers/<dupe>`);
      console.warn('  deleting a customer cancels its subscriptions, so empty ' +
                   'the record before you delete it');
    }
  }
  console.warn(`  prevent: GET ${API}/customers?email=<address>&limit=1 before ` +
               'creating, and store the cus_ id on your own user row');
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
