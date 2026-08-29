/**
 * Report Stripe invoices where the automatic tax calculation never completed.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// An invoice past draft has its tax lines frozen; nothing can be recalculated on
// it, only credited.
export const FINALIZED = ['open', 'paid', 'uncollectible', 'void'];

// States where money has already moved with the wrong tax on it.
export const BILLED = ['billed-untaxed', 'billed-unpriced', 'frozen'];

/**
 * Classify one invoice's tax calculation. Pure, so it is testable offline.
 * `finalized` says whether the invoice has left draft.
 */
export function verdict(taxStatus, disabledReason, finalized) {
  if (disabledReason === 'finalization_requires_location_inputs') {
    return ['billed-untaxed',
      'automatic tax was switched off at finalization for want of a location: ' +
      'this invoice went out with no tax and no error'];
  }
  if (disabledReason === 'finalization_system_error') {
    return ['billed-unpriced',
      'Stripe could not calculate at finalization and disabled tax to let the ' +
      'invoice through'];
  }
  if (taxStatus === 'requires_location_inputs') {
    if (finalized) {
      return ['frozen',
        'the location was not resolvable and the invoice is already finalized: ' +
        'the tax on it can no longer be changed'];
    }
    return ['blocked',
      'the calculation cannot run for want of a location; still a draft, so ' +
      'fixing the customer is enough'];
  }
  if (taxStatus === 'failed') {
    return ['failed',
      "the calculation failed on Stripe's side; retry before assuming the " +
      'customer record is wrong'];
  }
  if (taxStatus === 'complete') {
    return ['complete',
      'the calculation ran; zero tax here is a registration question, not a ' +
      'location one'];
  }
  return ['unknown', `unrecognised automatic_tax.status ${JSON.stringify(taxStatus)}`];
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

export async function invoicesSince(key, days = 90, limit = 5000) {
  const cutoff = Math.floor(Date.now() / 1000 - days * 86400);
  const out = [];
  const params = { limit: 100, 'created[gte]': cutoff };
  for (;;) {
    const page = await get(key, '/invoices', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) break;
    params.starting_after = data[data.length - 1].id;
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

  const days = Number(process.argv[2] ?? 90);
  let seen = 0;
  const byCustomer = new Map();

  for (const inv of await invoicesSince(key, days)) {
    seen += 1;
    const tax = inv.automatic_tax ?? {};
    if (!tax.enabled) continue;
    const [state, detail] = verdict(tax.status, tax.disabled_reason,
      FINALIZED.includes(inv.status));
    if (state === 'complete' || state === 'unknown') continue;
    const cus = (typeof inv.customer === 'object' && inv.customer !== null
      ? inv.customer.id : inv.customer) ?? '<no customer>';
    const entry = byCustomer.get(cus) ?? { n: 0, amount: 0, billed: 0, state, detail };
    entry.n += 1;
    entry.amount += inv.total ?? 0;
    if (BILLED.includes(state)) entry.billed += 1;
    byCustomer.set(cus, entry);
  }

  if (byCustomer.size === 0) {
    console.log(`${'clear'.padEnd(15)} 0 of ${seen} invoice(s) with an incomplete tax calculation`);
    return;
  }

  const entries = [...byCustomer.entries()]
    .sort((a, b) => (b[1].billed - a[1].billed) || (b[1].n - a[1].n));
  const affected = entries.reduce((a, [, e]) => a + e.n, 0);
  const total = entries.reduce((a, [, e]) => a + e.amount, 0);
  console.warn(`${'tax-incomplete'.padEnd(15)} ${entries.length} customer(s), ${affected} of ${seen} invoice(s), ${total} in minor units billed`);

  for (const [cus, e] of entries.slice(0, 20)) {
    console.warn(`  ${e.state.padEnd(15)} ${cus}  ${e.n} invoice(s), ${e.billed} already billed  ${e.detail}`);
    console.warn(`      GET ${API}/customers/${cus}?expand[]=tax   expect tax.automatic_tax = unrecognized_location`);
    if (e.state !== 'failed') {
      console.warn(`      repair: POST ${API}/customers/${cus}  address[country]=..  address[postal_code]=..  tax[validate_location]=immediately`);
    }
  }
  if (entries.length > 20) console.warn(`  ... and ${entries.length - 20} more customer(s)`);
  console.warn('  invoices already finalized keep the tax they were finalized ' +
               'with; a credit note and a reissue is the only correction');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
