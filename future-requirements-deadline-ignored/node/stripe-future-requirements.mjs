/**
 * Report connected accounts whose future_requirements will disable a capability.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const DAY = 86400;

/**
 * Classify one account's future_requirements. Pure: `now` is an argument, so the
 * ordering this produces can be tested against a fixed clock.
 */
export function verdict(account, now, soonDays = 14) {
  const controller = account.controller ?? {};
  if (controller.requirement_collection !== 'application') {
    return ['stripe-managed',
      'Stripe collects for this account and handles the update itself'];
  }

  const fr = account.future_requirements ?? {};
  const past = fr.past_due ?? [];
  const due = fr.currently_due ?? [];
  const eventually = fr.eventually_due ?? [];
  const deadline = fr.current_deadline;

  if (past.length) {
    return ['overdue',
      `${past.length} future field(s) already past due (${past.join(', ')})`];
  }
  if (due.length) {
    if (deadline === null || deadline === undefined) {
      return ['undated',
        `${due.length} future field(s) with no deadline set yet (${due.join(', ')})`];
    }
    const days = (deadline - now) / DAY;
    if (days <= 0) {
      return ['overdue',
        `the deadline passed ${(-days).toFixed(1)} day(s) ago; these fields are ` +
        'moving into requirements now'];
    }
    if (days <= soonDays) {
      return ['due-soon',
        `${due.length} future field(s) in ${days.toFixed(1)} day(s) (${due.join(', ')})`];
    }
    return ['scheduled', `${due.length} future field(s) in ${days.toFixed(1)} day(s)`];
  }
  if (eventually.length) {
    return ['eventual',
      `${eventually.length} field(s) Stripe will want at a later threshold`];
  }
  return ['clear', 'no future requirements'];
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

const ORDER = { overdue: 0, 'due-soon': 1, scheduled: 2, undated: 3, eventual: 4 };

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }
  const soonDays = 14;
  const now = Date.now() / 1000;

  let total = 0;
  const rows = [];
  for await (const acct of paginate(key, '/accounts', 500)) {
    total += 1;
    const [state, detail] = verdict(acct, now, soonDays);
    if (state === 'clear' || state === 'stripe-managed') continue;
    const fr = acct.future_requirements ?? {};
    rows.push([ORDER[state] ?? 9, fr.current_deadline ?? Infinity, state, acct.id, detail]);
  }

  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const counts = {};
  for (const [, , state, id, detail] of rows) {
    counts[state] = (counts[state] ?? 0) + 1;
    console.warn(`${state.padEnd(11)} ${id}  ${detail}`);
    console.warn(`  repair: POST ${API}/accounts/${id} with the future field(s) ` +
                 'before the deadline');
    console.warn('  hosted: create an account link with ' +
                 'collection_options[future_requirements]=include');
  }

  console.log(`${total} account(s): ${counts.overdue ?? 0} overdue, ` +
              `${counts['due-soon'] ?? 0} due within ${soonDays} days, ` +
              `${counts.scheduled ?? 0} scheduled, ${counts.undated ?? 0} undated`);
  process.exitCode = (counts.overdue || counts['due-soon']) ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
