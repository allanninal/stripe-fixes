/**
 * Report the Persons whose outstanding requirements are blocking an account.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Return the Person id an account-level requirement points at, or null.
 * Account requirements read like person_1MqEZ.verification.document.
 */
export function personRef(entry) {
  if (typeof entry !== 'string' || !entry.startsWith('person_')) return null;
  return entry.split('.')[0];
}

/**
 * Classify one Person object. Pure, so the rules are visible and testable.
 */
export function verdict(person) {
  const req = person.requirements ?? {};
  const past = req.past_due ?? [];
  const due = req.currently_due ?? [];
  const status = person.verification?.status;

  if (past.length) {
    return ['past-due',
      `${past.length} field(s) past due (${past.join(', ')}); capabilities that ` +
      'depend on this person are already off'];
  }
  if (due.length) {
    return ['blocking', `${due.length} field(s) currently due (${due.join(', ')})`];
  }
  if (status === 'pending') {
    return ['verifying',
      'submitted and under review; nothing to collect, and a link sent now opens ' +
      'a form with no fields on it'];
  }
  if (status === 'unverified') {
    return ['unverified',
      'not verified and nothing due yet; Stripe asks at a threshold, so this is ' +
      'the cheap moment to collect it'];
  }
  if (status === 'verified') return ['clear', 'verified, nothing outstanding'];
  return ['unknown', `unrecognised verification status ${JSON.stringify(status)}`];
}

/** The Person ids the account's own requirements point at, in order seen. */
export function blockedOn(account) {
  const req = account.requirements ?? {};
  const out = [];
  for (const entry of [...(req.past_due ?? []), ...(req.currently_due ?? [])]) {
    const pid = personRef(entry);
    if (pid && !out.includes(pid)) out.push(pid);
  }
  return out;
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

async function* paginate(key, path, limit) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, path, params);
    const data = page.data ?? [];
    for (const obj of data) {
      yield obj;
      if (++seen >= limit) return;
    }
    if (!page.has_more || data.length === 0) return;
    params.starting_after = data[data.length - 1].id;
  }
}

function describe(person) {
  const rel = person.relationship ?? {};
  const roles = Object.keys(rel).filter((k) => rel[k] === true).sort();
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
  return roles.join('/') || name || person.id || '?';
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }
  const showClear = process.argv.includes('--show-clear');

  let accounts = 0, people = 0, bad = 0;
  for await (const acct of paginate(key, '/accounts', 500)) {
    accounts += 1;
    const pointedAt = blockedOn(acct);
    for await (const person of paginate(key, `/accounts/${acct.id}/persons`, 100)) {
      people += 1;
      const [state, detail] = verdict(person);
      const line = `${state.padEnd(10)} ${acct.id} ${person.id} ` +
                   `(${describe(person)})  ${detail}`;
      if ((state === 'clear' || state === 'unverified') && !showClear) continue;
      if (state === 'clear' || state === 'verifying' || state === 'unverified') {
        console.log(line);
        continue;
      }
      bad += 1;
      console.warn(line);
      if (pointedAt.includes(person.id)) {
        console.warn("  the account's own requirements name this person");
      }
      console.warn(`  repair: POST ${API}/accounts/${acct.id}/persons/${person.id} ` +
                   'with the field(s) above');
      console.warn('  for a document, upload it to files.stripe.com with ' +
                   'purpose=identity_document and set verification[document][front]');
    }
  }

  console.log(`${accounts} account(s), ${people} person(s), ${bad} needing attention`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
