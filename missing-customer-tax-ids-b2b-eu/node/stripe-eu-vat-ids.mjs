/**
 * Report EU business invoices billed with VAT because no tax ID was on file.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Invoices and Customers. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// The 27 member states. Reverse charge is an intra-EU mechanism, so a country
// outside this set is a different question with a different answer.
export const EU = new Set(('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT ' +
  'LU MT NL PL PT RO SK SI ES SE').split(' '));

// Verification results that are not a confirmation. `pending` is normal for a
// few minutes and a problem after a few months.
export const UNCONFIRMED = ['unverified', 'unavailable', 'pending'];

/**
 * Classify one paid invoice. Pure, so the rules can be tested without a network.
 * `invoiceTaxIds` is the invoice's customer_tax_ids array, frozen at finalization.
 */
export function verdict(country, invoiceTaxIds, taxExempt, taxAmount, verification) {
  if (!EU.has(country)) {
    return ['out-of-scope',
      `${country || 'no country on the invoice'} is outside the EU: the reverse ` +
      'charge does not apply here'];
  }
  if (taxExempt === 'reverse') {
    return ['reverse-charge',
      'billed under the reverse charge; the buyer accounts for the VAT'];
  }
  if (taxExempt === 'exempt') {
    return ['exempt', 'recorded as exempt, so no VAT was due and none was charged'];
  }
  if (!invoiceTaxIds || invoiceTaxIds.length === 0) {
    if (taxAmount) {
      return ['charged-vat',
        `no customer_tax_ids on the invoice and ${taxAmount} in tax charged: a ` +
        'business was billed as a consumer'];
    }
    return ['no-id-no-vat',
      'no tax ID and no VAT either; that is a registration question rather than ' +
      'a reverse charge one'];
  }
  if (UNCONFIRMED.includes(verification)) {
    return ['unverified',
      `a tax ID is on the invoice but its verification status is ` +
      `${JSON.stringify(verification)}: not a number to rely on`];
  }
  return ['ok', 'a verified tax ID is recorded on the invoice'];
}

/** Total tax on the invoice in minor units, across every tax line. */
export function taxCharged(inv) {
  return (inv.total_taxes ?? []).reduce((a, t) => a + (t.amount ?? 0), 0);
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

export async function paidInvoices(key, days = 180, limit = 5000) {
  const cutoff = Math.floor(Date.now() / 1000 - days * 86400);
  const out = [];
  const params = { status: 'paid', limit: 100, 'created[gte]': cutoff };
  for (;;) {
    const page = await get(key, '/invoices', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

async function verificationStatus(key, customerId, cache) {
  if (cache.has(customerId)) return cache.get(customerId);
  let status = null;
  try {
    const { data = [] } = await get(key, `/customers/${customerId}/tax_ids`, { limit: 10 });
    for (const tid of data) {
      const s = tid.verification?.status;
      if (UNCONFIRMED.includes(s)) { status = s; break; }
      status = status ?? s ?? null;
    }
  } catch {
    status = null;
  }
  cache.set(customerId, status);
  return status;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number(process.argv[2] ?? 180);
  const cache = new Map();
  let euSeen = 0;
  const findings = [];

  for (const inv of await paidInvoices(key, days)) {
    const country = inv.customer_address?.country ?? '';
    if (!EU.has(country)) continue;
    euSeen += 1;
    const cus = (typeof inv.customer === 'object' && inv.customer !== null
      ? inv.customer.id : inv.customer) ?? null;
    const ids = inv.customer_tax_ids ?? [];
    const verification = ids.length && cus
      ? await verificationStatus(key, cus, cache) : null;
    const tax = taxCharged(inv);
    const [state, detail] = verdict(country, ids, inv.customer_tax_exempt, tax, verification);
    if (['charged-vat', 'unverified', 'no-id-no-vat'].includes(state)) {
      findings.push({ state, id: inv.id ?? '<no id>', cus, country, tax, detail });
    }
  }

  if (findings.length === 0) {
    console.log(`${'clear'.padEnd(13)} 0 of ${euSeen} EU invoice(s) billed to a business as a consumer`);
    return;
  }

  const charged = findings.filter((f) => f.state === 'charged-vat');
  const chargedTax = charged.reduce((a, f) => a + f.tax, 0);
  console.warn(`${'no-tax-id'.padEnd(13)} ${findings.length} of ${euSeen} EU invoice(s) flagged, ${charged.length} charged VAT with no tax ID, ${chargedTax} in minor units`);

  findings.sort((a, b) => b.tax - a.tax);
  for (const f of findings.slice(0, 20)) {
    console.warn(`  ${f.state.padEnd(13)} ${f.id}  ${f.cus}  ${f.country}  ${f.tax}  ${f.detail}`);
    if (f.state === 'charged-vat') {
      console.warn(`      repair: POST ${API}/tax_ids  type=eu_vat  value=${f.country}123456789  owner[type]=customer  owner[customer]=${f.cus}`);
      console.warn('      the invoice itself is frozen: correct it with a credit note and a reissue, not an edit');
    }
  }
  if (findings.length > 20) console.warn(`  ... and ${findings.length - 20} more`);
  console.warn('  then switch on tax ID collection in Checkout and allow the ' +
               'tax_id field in the billing portal, or the list refills');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
