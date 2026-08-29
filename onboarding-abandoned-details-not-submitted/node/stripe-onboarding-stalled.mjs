/**
 * Report connected accounts that never finished onboarding.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const STALE_DAYS = 7;  // below this, the seller may still be signing up
const NEARLY_DONE = 3;        // few enough left that the session died near the end

/**
 * Sort one connected account by how far its onboarding got. Pure, so the age
 * threshold and the never-started split can be tested without a clock.
 * `ageDays` is null when the account has no created timestamp.
 * Returns [state, detail].
 */
export function classify(account, ageDays, staleDays = STALE_DAYS) {
  const reqs = account.requirements ?? {};
  const due = (reqs.currently_due ?? []).filter(Boolean);

  if (account.details_submitted) {
    return ['submitted', 'details_submitted is true: onboarding completed'];
  }

  if (ageDays === null || ageDays === undefined) {
    return ['unknown',
      'details_submitted is false and there is no created timestamp to age it against'];
  }

  if (ageDays < staleDays) {
    return ['in-flight',
      `${ageDays.toFixed(1)} days old and not submitted: may still be signing ` +
      'up, so do not chase it yet'];
  }

  if (!due.length) {
    return ['unknown',
      `${ageDays.toFixed(0)} days old, not submitted, and nothing is currently ` +
      'due: no capability has been requested, so Stripe is not asking for anything'];
  }

  if (due.length <= NEARLY_DONE) {
    return ['abandoned-late',
      `${ageDays.toFixed(0)} days old with ${due.length} field(s) left ` +
      `(${due.slice(0, 3).join(', ')}): got most of the way, then the session ` +
      'ended. Worth a fresh link and an email'];
  }

  return ['abandoned-cold',
    `${ageDays.toFixed(0)} days old with ${due.length} field(s) still due: the ` +
    'form was never worked through'];
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

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const now = Date.now() / 1000;
  const counts = {};
  let scanned = 0;
  for await (const acct of accounts(key)) {
    scanned += 1;
    const age = acct.created === undefined || acct.created === null
      ? null : (now - acct.created) / 86400;
    const [state, detail] = classify(acct, age);
    counts[state] = (counts[state] ?? 0) + 1;
    if (state === 'submitted' || state === 'in-flight') continue;
    console.warn(`${acct.id ?? 'acct_?'}  ${state.padEnd(15)} ${detail}`);
  }

  const late = counts['abandoned-late'] ?? 0;
  const cold = counts['abandoned-cold'] ?? 0;

  console.log(`${scanned} account(s): ${counts['in-flight'] ?? 0} in flight, ` +
              `${late + cold} abandoned`);

  if (late || cold) {
    console.warn('  repair, in this order:');
    console.warn('  1. make refresh_url mint a new link and 302 to it. Stripe ' +
                 'sends the user there precisely when the old one is spent:');
    console.warn(`  POST ${API}/account_links  account, refresh_url, return_url, ` +
                 'type=account_onboarding');
    console.warn('  2. never email or SMS the returned url. It is single use, and ' +
                 'a client fetching a preview of it uses it.');
    console.warn(`  3. re-onboard the ${late + cold} account(s) above with fresh ` +
                 `links, starting with the ${late} that nearly finished.`);
    process.exitCode = 1;
  }
}

// Only run when invoked directly, so importing this module in the test file does
// not run main(), fail on the missing key and fail the suite.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
