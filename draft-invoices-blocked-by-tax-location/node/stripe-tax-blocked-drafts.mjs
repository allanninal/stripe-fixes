/**
 * Report Stripe draft invoices that cannot finalize because Stripe Tax cannot
 * locate the customer.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const TAX_LOCATION_ERROR = 'customer_tax_location_invalid';
export const TAX_DISABLED_FOR_LOCATION = 'finalization_requires_location_inputs';

// States that mean a human has to touch the customer record or the invoice.
export const ACTIONABLE = ['tax-location', 'tax-dropped', 'needs-address', 'tax-failed'];

/**
 * Classify one draft invoice. Pure, so the rules can be tested without a network.
 * Any of the first three arguments may be null or undefined.
 */
export function verdict(errorCode, taxStatus, disabledReason, autoAdvance) {
  if (errorCode === TAX_LOCATION_ERROR) {
    return ['tax-location',
      'finalization was attempted and refused: Stripe Tax cannot resolve this ' +
      "customer's location"];
  }
  if (disabledReason === TAX_DISABLED_FOR_LOCATION) {
    return ['tax-dropped',
      'Stripe switched automatic tax off so this invoice can finalize; it will ' +
      'be billed and paid with no tax on it'];
  }
  if (taxStatus === 'requires_location_inputs') {
    return ['needs-address',
      'the tax calculation cannot run for want of a location; no finalization ' +
      'attempt has failed yet, but one will'];
  }
  if (taxStatus === 'failed') {
    return ['tax-failed',
      "the calculation failed on Stripe's side; retry the finalization before " +
      'editing the customer'];
  }
  if (errorCode) {
    return ['other-error',
      `finalization is failing for a reason that is not tax: ${errorCode}`];
  }
  if (!autoAdvance) {
    return ['not-advancing',
      'auto_advance is false: this draft is outside the collection workflow ' +
      'rather than blocked by tax'];
  }
  return ['clear', 'no tax finalization problem recorded on this draft'];
}

/** Pull the four fields off an invoice and hand them to verdict(). */
export function classify(inv) {
  const err = inv.last_finalization_error ?? {};
  const tax = inv.automatic_tax ?? {};
  return verdict(err.code, tax.status, tax.disabled_reason, Boolean(inv.auto_advance));
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

export async function drafts(key, limit = 2000) {
  const out = [];
  const params = { status: 'draft', limit: 100 };
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

  let seen = 0;
  const byCustomer = new Map();
  for (const inv of await drafts(key)) {
    seen += 1;
    const [state, detail] = classify(inv);
    if (!ACTIONABLE.includes(state)) continue;
    const cus = (typeof inv.customer === 'object' && inv.customer !== null
      ? inv.customer.id : inv.customer) ?? '<no customer>';
    const entry = byCustomer.get(cus)
      ?? { n: 0, amount: 0, state, detail, first: inv.id };
    entry.n += 1;
    entry.amount += inv.amount_due ?? 0;
    byCustomer.set(cus, entry);
  }

  if (byCustomer.size === 0) {
    console.log(`${'clear'.padEnd(13)} 0 of ${seen} draft invoice(s) blocked on tax location`);
    return;
  }

  const entries = [...byCustomer.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const drafted = entries.reduce((a, [, e]) => a + e.n, 0);
  const atStake = entries.reduce((a, [, e]) => a + e.amount, 0);
  console.warn(`${'tax-blocked'.padEnd(13)} ${entries.length} customer(s), ${drafted} draft(s), ${atStake} in minor units uncollected`);

  for (const [cus, e] of entries.slice(0, 20)) {
    console.warn(`  ${e.state.padEnd(13)} ${cus}  ${e.n} draft(s)  ${e.amount}  ${e.detail}`);
    console.warn(`      GET ${API}/customers/${cus}?expand[]=tax   read tax.automatic_tax and tax.location`);
    console.warn(`      repair: POST ${API}/customers/${cus}  address[country]=..  address[postal_code]=..  tax[validate_location]=immediately`);
    console.warn(`      then: POST ${API}/invoices/${e.first}/finalize`);
  }
  if (entries.length > 20) console.warn(`  ... and ${entries.length - 20} more customer(s)`);
  console.warn('  fix the customer before the invoice; finalizing first either ' +
               'fails again or bills with no tax on it');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
