/**
 * Report Stripe subscriptions billing without automatic_tax while invoicing abroad.
 *
 * Read only. Two paginated GETs and no writes: give this a RESTRICTED key with
 * read access to Subscriptions and Invoices. The repair is printed, never performed.
 *
 * This is a configuration check, not tax advice.
 */
const API = 'https://api.stripe.com/v1';

// Jurisdictions where a remote seller most commonly acquires a collection
// obligation. Deliberately not exhaustive: the point is to raise the question for
// the obvious cases, not to decide the answer.
export const REGISTRATION_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'GB', 'NO', 'CH', 'AU', 'NZ', 'CA', 'JP', 'SG', 'AE', 'ZA', 'IN',
]);

/**
 * Classify the account. Pure, so the rules can be tested without a network.
 * `countries` is the distinct set of customer_address.country values seen on
 * untaxed paid invoices.
 */
export function verdict(offCount, totalCount, countries) {
  if (!totalCount) return ['empty', 'no active subscriptions to check'];
  if (!offCount) {
    return ['on', `automatic_tax is enabled on all ${totalCount} active subscription(s)`];
  }
  const seen = [...new Set((countries ?? []).filter(Boolean).map((c) => c.toUpperCase()))].sort();
  if (seen.length === 0) {
    return ['unknown',
      `${offCount} of ${totalCount} active subscription(s) have automatic_tax off, ` +
      'and no untaxed invoice carries customer_address.country: the exposure ' +
      'cannot be judged, and Stripe could not compute tax either'];
  }
  const exposed = seen.filter((c) => REGISTRATION_COUNTRIES.has(c));
  if (exposed.length) {
    const where = exposed.join(', ');
    if (offCount >= totalCount) {
      return ['exposed',
        `automatic_tax is off on all ${totalCount} active subscription(s), and ` +
        `untaxed invoices went to ${where}`];
    }
    return ['partial',
      `${offCount} of ${totalCount} active subscription(s) have automatic_tax off: ` +
      'the create path was fixed and the older ones never backfilled. ' +
      `Untaxed invoices went to ${where}`];
  }
  if (seen.length > 1) {
    return ['multi_country',
      `${offCount} of ${totalCount} off, and untaxed invoices span ${seen.length} ` +
      `countries (${seen.join(', ')})`];
  }
  return ['domestic',
    `${offCount} of ${totalCount} off, but every untaxed invoice is billed to ` +
    `${seen[0]}. Check that against your registrations rather than assuming it is wrong`];
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

export async function pageAll(key, path, limit, params = {}) {
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

  const subs = await pageAll(key, '/subscriptions', 2000, { status: 'active' });
  const off = subs.filter((x) => !(x.automatic_tax?.enabled));

  const countries = [];
  for (const inv of await pageAll(key, '/invoices', 1000, { status: 'paid' })) {
    if (inv.automatic_tax?.enabled) continue;
    const country = inv.customer_address?.country;
    if (country) countries.push(country);
  }

  const [state, detail] = verdict(off.length, subs.length, countries);
  const line = `${state.padEnd(13)} ${detail}`;
  if (state === 'on' || state === 'empty') { console.log(line); return; }

  console.warn(line);
  console.warn('  register first: Stripe calculates zero where you have no active ' +
               'registration, which looks identical to tax being off');
  console.warn(`  then set it on every create path: POST ${API}/subscriptions and ` +
               `POST ${API}/checkout/sessions both take automatic_tax[enabled]=true`);
  console.warn(`  then backfill: POST ${API}/subscriptions/<sub> automatic_tax[enabled]=true`);
  for (const sub of off.slice(0, 10)) console.warn(`      ${sub.id ?? '<no id>'}`);
  if (off.length > 10) console.warn(`      ... and ${off.length - 10} more`);
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
