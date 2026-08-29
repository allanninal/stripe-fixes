/**
 * Report Stripe send_invoice subscriptions that write invoices with no due date.
 *
 * Read only. Two paginated GETs and no writes: give this a RESTRICTED key with
 * read access to Subscriptions and Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Roughly how many days each recurring interval is worth. Used only to compare
// payment terms against the billing period, so month lengths do not matter.
export const INTERVAL_DAYS = { day: 1, week: 7, month: 30, year: 365 };

/**
 * Classify one subscription. Pure, so the rules can be tested without a network.
 * `daysUntilDue` is the raw field: null when absent, and 0 is a real value.
 */
export function verdict(collectionMethod, daysUntilDue, intervalDays, undatedOpenInvoices) {
  if (collectionMethod !== 'send_invoice') {
    return ['automatic',
      `collection_method is ${JSON.stringify(collectionMethod)}: Stripe charges ` +
      'the payment method on file, so days_until_due does not apply'];
  }
  if (daysUntilDue === null || daysUntilDue === undefined) {
    if (undatedOpenInvoices) {
      return ['undated',
        `days_until_due is null and ${undatedOpenInvoices} open invoice(s) already ` +
        'have due_date null: nothing can mark them overdue'];
    }
    return ['unanchored',
      'days_until_due is null, so every invoice this subscription writes will ' +
      'have due_date null and can never age'];
  }
  if (daysUntilDue === 0) {
    return ['on-receipt', 'net 0, due on receipt: a real term, not a missing one'];
  }
  if (intervalDays && daysUntilDue >= intervalDays) {
    return ['overlapping',
      `net ${daysUntilDue} on a ${intervalDays} day billing period: the next ` +
      'invoice is issued before this one is due'];
  }
  return ['dated',
    `net ${daysUntilDue}; due_date is set and the past due machinery has ` +
    'something to measure from'];
}

/** Billing period length in days, or null when the price cannot be read. */
export function intervalDays(sub) {
  const items = sub.items?.data ?? [];
  if (items.length === 0) return null;
  const recurring = items[0].price?.recurring ?? {};
  const unit = INTERVAL_DAYS[recurring.interval];
  if (!unit) return null;
  return unit * (recurring.interval_count ?? 1);
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

async function pageAll(key, path, limit, params = {}) {
  const out = [];
  const q = { ...params, limit: 100 };
  for (;;) {
    const page = await get(key, path, q);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) break;
    q.starting_after = data[data.length - 1].id;
  }
  return out;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const maxRows = Number(process.argv[2] ?? 2000);

  const undated = new Map();
  for (const inv of await pageAll(key, '/invoices', maxRows,
    { status: 'open', collection_method: 'send_invoice' })) {
    if (inv.due_date === null || inv.due_date === undefined) {
      const sub = typeof inv.subscription === 'object' && inv.subscription !== null
        ? inv.subscription.id : inv.subscription;
      undated.set(sub, (undated.get(sub) ?? 0) + 1);
    }
  }

  const subs = await pageAll(key, '/subscriptions', maxRows,
    { collection_method: 'send_invoice', status: 'all' });
  if (subs.length === 0) {
    console.log("no send_invoice subscriptions for this key's mode");
    return;
  }

  const rows = subs.map((sub) => ({
    id: sub.id ?? '<no id>',
    v: verdict(sub.collection_method, sub.days_until_due, intervalDays(sub),
      undated.get(sub.id) ?? 0),
  }));

  const bad = rows.filter((r) => ['undated', 'unanchored', 'overlapping'].includes(r.v[0]));
  if (bad.length === 0) {
    console.log(`${'clear'.padEnd(11)} 0 of ${rows.length} send_invoice subscription(s) without terms`);
    return;
  }

  console.warn(`${'unterm'.padEnd(11)} ${bad.length} of ${rows.length} send_invoice subscription(s) need terms`);
  for (const r of bad.slice(0, 20)) {
    console.warn(`  ${r.v[0].padEnd(11)} ${r.id}  ${r.v[1]}`);
    console.warn(`      repair: POST ${API}/subscriptions/${r.id}  days_until_due=30`);
  }
  if (bad.length > 20) console.warn(`  ... and ${bad.length - 20} more`);
  console.warn('  then Dashboard > Settings > Billing > Invoices: enable the ' +
               'reminder emails and set the past due subscription action');
  console.warn('  invoices already finalized keep their null due_date; those ' +
               'need a resend or a write off, one at a time');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
