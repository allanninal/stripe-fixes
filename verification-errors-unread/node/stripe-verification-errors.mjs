/**
 * Report unread requirements.errors on connected accounts, with the fix for each.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// A new file is required. The same one re-uploaded fails automatically.
const DOCUMENT_CODES = {
  verification_document_failed_greyscale:
    'the upload was greyscale: a colour scan or photo of the same document',
  verification_document_not_readable:
    'the image could not be read: re-capture it in focus and uncropped',
  verification_document_expired:
    'the document is out of date: a current one, not a better scan',
  verification_document_missing_back:
    'only one side was submitted: the back of the same document',
  verification_document_failed_other:
    'rejected without a specific cause: a different capture, colour, under the ' +
    'size limits, and an image rather than a PDF for identity documents',
};

// A new file will never fix this. The typed fields are what disagree.
const IDENTITY_CODES = {
  verification_failed_keyed_identity:
    'the typed name or date of birth does not match the document: correct the ' +
    'fields, not the file',
};

// Ordinary field edits on the account or person.
const FIELD_CODES = {
  information_missing:
    'a required field was left out: read the requirement and supply it',
  verification_missing_owners:
    'beneficial owners are missing: add the Person objects for them',
  invalid_street_address:
    'the address could not be validated: check it against the postal service ' +
    'format for the country',
  invalid_tax_id_format:
    'the tax id is not in the format for that country',
};

// The whole invalid_url_website_* family, matched by prefix.
const WEBSITE_PREFIX = 'invalid_url_website';

const GROUPS = [
  ['document', DOCUMENT_CODES],
  ['identity', IDENTITY_CODES],
  ['field', FIELD_CODES],
];

/**
 * Turn a requirements.errors array into one state and one instruction. Pure, so
 * the code table can be tested without a network. An unrecognised code returns
 * `unmapped` rather than `clear`: Stripe adds codes, and a table that silently
 * swallows new ones is worse than no table.
 * Returns [state, detail].
 */
export function classify(errors) {
  const items = (errors ?? []).filter((e) => e && typeof e === 'object' && e.code);
  if (!items.length) return ['clear', 'requirements.errors is empty'];

  for (const [state, table] of GROUPS) {
    for (const e of items) {
      if (e.code in table) {
        return [state,
          `${e.code} on ${e.requirement || 'an unnamed requirement'}: ${table[e.code]}`];
      }
    }
  }

  for (const e of items) {
    if (String(e.code).startsWith(WEBSITE_PREFIX)) {
      return ['website',
        `${e.code} on ${e.requirement || 'business_profile.url'}: fix the site ` +
        'itself, then set business_profile[url] to another value and back to ' +
        'force re-verification'];
    }
  }

  const e = items[0];
  return ['unmapped',
    `${e.code} on ${e.requirement || 'an unnamed requirement'}: ` +
    `${e.reason || 'no reason string returned'}`];
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

export async function* accounts(key, cap = 5000) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/accounts', params);
    const data = page.data ?? [];
    for (const acct of data) {
      yield acct;
      seen += 1;
      if (seen >= cap) return;
    }
    if (data.length === 0 || !page.has_more) return;
    params.starting_after = data[data.length - 1].id;
  }
}

async function errorSources(key, account, deep) {
  const out = [
    ['account', account.requirements?.errors ?? []],
    ['future', account.future_requirements?.errors ?? []],
  ];
  if (!deep) return out;
  const persons = await get(key, `/accounts/${account.id}/persons`, { limit: 100 });
  for (const p of persons.data ?? []) {
    out.push([`person ${p.id ?? 'person_?'}`, p.requirements?.errors ?? []]);
  }
  const caps = await get(key, `/accounts/${account.id}/capabilities`);
  for (const c of caps.data ?? []) {
    out.push([`capability ${c.id ?? '?'}`, c.requirements?.errors ?? []]);
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
  const deep = process.argv.includes('--persons');

  let withErrors = 0;
  let unmapped = 0;
  let scanned = 0;
  for await (const acct of accounts(key)) {
    scanned += 1;
    let hits = 0;
    for (const [where, errors] of await errorSources(key, acct, deep)) {
      const [state, detail] = classify(errors);
      if (state === 'clear') continue;
      hits += 1;
      if (state === 'unmapped') unmapped += 1;
      console.warn(`${acct.id ?? 'acct_?'}  ${state.padEnd(9)} ${where.padEnd(12)} ${detail}`);
    }
    if (hits) withErrors += 1;
  }

  console.log(`${scanned} account(s): ${withErrors} with errors, ` +
              `${unmapped} unmapped code(s)`);

  if (withErrors) {
    console.warn('  repair: show the mapped instruction and the reason string in ' +
                 'your onboarding UI, then require a genuinely different ' +
                 'submission. The same file re-uploaded fails on its own.');
    console.warn('  documents: upload to https://files.stripe.com/v1/files with ' +
                 "purpose=identity_document, then attach the file id to the " +
                 "person's verification[document][front]");
    console.warn(`  fields: POST ${API}/accounts/{id} with the corrected values`);
    process.exitCode = 1;
  }
  if (unmapped) {
    console.warn('  add the unmapped code(s) above to the table in this script. ' +
                 'Stripe adds codes; a stale table shows a seller nothing.');
  }
}

// Only run when invoked directly, so importing this module in the test file does
// not run main(), fail on the missing key and fail the suite.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
