/**
 * Report countries you invoice into with no active Stripe Tax registration.
 *
 * Read only. Three GETs, no writes: give this a RESTRICTED key with read access
 * to Tax and Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Roughly where Stripe's own threshold monitoring starts emailing, in minor units
// of the invoice currency. Currencies are not converted: this is a triage rank,
// not an accounting figure.
export const WATCH_MINOR = 1000000;

/**
 * Classify one billed country. Pure, so the rules can be tested offline.
 * `registered` and `expired` are Sets of country codes. Returns [state, detail].
 */
export function verdict(country, registered, expired, revenueMinor, invoiceCount) {
  const where = `${invoiceCount} paid invoice(s), ${revenueMinor} minor unit(s) billed`;
  if (registered.has(country)) return ['covered', `registered, ${where}`];
  if (expired.has(country)) {
    return ['lapsed',
      'a registration existed and has expired, so collection stopped on a known ' +
      `date. ${where} since.`];
  }
  if (revenueMinor >= WATCH_MINOR) {
    return ['exposed',
      `no registration and ${where}. This is the size at which a threshold is the ` +
      'likely explanation for the letter.'];
  }
  return ['unregistered', `no registration, ${where}`];
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

async function* paginate(key, path, params = {}) {
  const p = { limit: 100, ...params };
  for (;;) {
    const page = await get(key, path, p);
    const data = page.data ?? [];
    for (const row of data) yield row;
    if (data.length === 0 || !page.has_more) return;
    p.starting_after = data[data.length - 1].id;
  }
}

/**
 * Country codes with a registration in the given status. US registrations are per
 * state, so a US row is recorded as US-CA: one state does not cover the other 49.
 */
export async function registrationCountries(key, status) {
  const out = new Set();
  for await (const reg of paginate(key, '/tax/registrations', { status })) {
    const country = (reg.country ?? '').toUpperCase();
    if (!country) continue;
    const state = reg.country_options?.us?.state;
    out.add(country === 'US' && state ? `US-${state.toUpperCase()}` : country);
  }
  return out;
}

/** Tally paid invoices by the customer's country. Returns a Map of code to totals. */
export async function billedCountries(key, since) {
  const tally = new Map();
  for await (const inv of paginate(key, '/invoices',
    { status: 'paid', 'created[gte]': since })) {
    const addr = inv.customer_address ?? {};
    const country = (addr.country ?? '').toUpperCase();
    if (!country) continue;
    const k = country === 'US' && addr.state
      ? `US-${addr.state.toUpperCase()}` : country;
    const prev = tally.get(k) ?? { count: 0, amount: 0 };
    tally.set(k, { count: prev.count + 1, amount: prev.amount + (inv.amount_paid ?? 0) });
  }
  return tally;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = 365;
  const registered = await registrationCountries(key, 'active');
  const expired = await registrationCountries(key, 'expired');
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const tally = await billedCountries(key, since);

  if (tally.size === 0) {
    console.log(`no paid invoices with a customer country in the last ${days} days`);
    return;
  }

  let findings = 0;
  const ordered = [...tally.entries()].sort((a, b) => b[1].amount - a[1].amount);
  for (const [country, { count, amount }] of ordered) {
    const [state, detail] = verdict(country, registered, expired, amount, count);
    const line = `${state.padEnd(12)} ${country.padEnd(6)} ${detail}`;
    if (state === 'covered') { console.log(line); continue; }
    findings += 1;
    console.warn(line);
  }

  if (findings) {
    console.warn('register with each authority, then record it so calculation ' +
      'starts returning a number rather than a correct zero');
    console.warn(`  GET ${API}/tax/registrations?status=active   ` +
      '(the list this check compares against)');
    console.warn('  Dashboard: Tax > Locations shows threshold progress per ' +
      'jurisdiction, which this API cannot');
  }
  console.log(`${tally.size} billed country/state(s), ${findings} without an active registration`);
  if (findings) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
