/**
 * Report Stripe accounts whose statement descriptor is missing or inconsistent.
 *
 * Read only. Three paginated GETs and no writes: give this a RESTRICTED key with
 * read access to Account, Charges and Disputes. The repair is printed, never run.
 */
const API = 'https://api.stripe.com/v1';

export const MIN_LEN = 5;
export const MAX_LEN = 22;
const MIN_LETTERS = 5;
const BANNED = ['<', '>', "'", '"'];
const UNRECOGNISED = new Set(['unrecognized', 'general', 'duplicate']);

/**
 * Classify the account's descriptor. Pure, so the format rules test offline.
 * `descriptors` is every calculated_statement_descriptor seen on recent charges.
 */
export function verdict(prefix, descriptors) {
  const seen = [...new Set((descriptors ?? [])
    .map((d) => (d ?? '').trim())
    .filter((d) => d !== ''))].sort();

  if (!(prefix ?? '').trim()) {
    return ['unset',
      `no statement descriptor prefix on the account; ${seen.length} distinct ` +
      'descriptor(s) observed on charges'];
  }
  if (descriptors && descriptors.length && seen.length === 0) {
    return ['blank',
      'a prefix is configured but every charge carried an empty descriptor: ' +
      'nothing identifying you reaches the networks'];
  }
  if (seen.length > 1) {
    return ['fragmented',
      `${seen.length} distinct descriptors in use (${seen.slice(0, 3).join(', ')}): ` +
      'Visa identifies a monitored account by the static component, so your ' +
      'volume is being split'];
  }
  const text = seen.length ? seen[0] : prefix.trim();
  const letters = [...text].filter((c) => /[a-z]/i.test(c)).length;
  if (text.length < MIN_LEN || text.length > MAX_LEN) {
    return ['malformed',
      `"${text}" is ${text.length} characters; Stripe requires ${MIN_LEN} to ${MAX_LEN}`];
  }
  if (letters < MIN_LETTERS) {
    return ['malformed',
      `"${text}" has ${letters} letter(s); Stripe requires at least ${MIN_LETTERS}`];
  }
  if (BANNED.some((c) => text.includes(c))) {
    return ['malformed',
      `"${text}" contains a character Stripe disallows in a descriptor`];
  }
  return ['consistent', `${text} across the sampled charges`];
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

async function page(key, path, cap, params = {}) {
  const out = [];
  const q = { ...params, limit: 100 };
  for (;;) {
    const p = await get(key, path, q);
    const data = p.data ?? [];
    out.push(...data);
    if (data.length === 0 || !p.has_more || out.length >= cap) break;
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

  const account = await get(key, '/account');
  const settings = account.settings ?? {};
  const prefix = settings.card_payments?.statement_descriptor_prefix
    ?? settings.payments?.statement_descriptor;

  const days = Number((process.env.DAYS || "dummy-days") ?? 30);
  const disputeDays = Number((process.env.DISPUTE_DAYS || "dummy-dispute-days") ?? 180);
  const now = Date.now() / 1000;
  const charges = await page(key, '/charges', 5000,
    { 'created[gte]': Math.floor(now - days * 86400) });
  const descriptors = charges.map((c) => c.calculated_statement_descriptor);
  const noSuffix = charges.filter((c) => !c.statement_descriptor_suffix).length;

  const [state, detail] = verdict(prefix, descriptors);
  console.log(`${state.padEnd(11)} ${detail} (${charges.length} charge(s) sampled)`);

  const disputes = await page(key, '/disputes', 1000,
    { 'created[gte]': Math.floor(now - disputeDays * 86400) });
  if (disputes.length) {
    const blind = disputes.filter((d) => UNRECOGNISED.has(d.reason)).length;
    console.log(`${(100 * blind / disputes.length).toFixed(1)}% of disputes cite ` +
                `unrecognized, general or duplicate (${blind} of ${disputes.length})`);
  }

  if (state === 'consistent' && !noSuffix) return;

  if (state !== 'consistent') {
    console.warn('  set the prefix in Dashboard, Settings, Business, public business ' +
                 `information: ${MIN_LEN} to ${MAX_LEN} characters, at least ` +
                 `${MIN_LETTERS} letters, and none of ${BANNED.join(' ')}`);
    console.warn('  use the website domain or the business name customers know, and ' +
                 'keep it identical across every payment flow');
  }
  if (noSuffix) {
    console.warn(`  ${noSuffix} of ${charges.length} charge(s) carried no ` +
                 'statement_descriptor_suffix. Set one at payment creation so the ' +
                 'line names the order.');
  }
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
