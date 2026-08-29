/**
 * Turn requirements.current_deadline into a dated queue of connected accounts.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const DAY = 86400;

/** Whole days from `now` to requirements.current_deadline. Null if unset. */
export function daysLeft(requirements, now) {
  const deadline = (requirements ?? {}).current_deadline;
  if (deadline === null || deadline === undefined) return null;
  return Math.floor((deadline - now) / DAY);
}

/**
 * The UTC calendar date a deadline falls on, as YYYY-MM-DD, or null.
 * Deadlines cluster, and grouping by the date is what turns a list of account
 * ids into one scheduled piece of work.
 */
export function cohortDay(deadline) {
  if (deadline === null || deadline === undefined) return null;
  return new Date(deadline * 1000).toISOString().slice(0, 10);
}

/**
 * Classify one account's current deadline. Pure. Returns [state, detail].
 * The states separate an incident that already happened, a batch to chase this
 * week, work for the calendar, and a deadline with nothing to collect.
 */
export function horizon(account, now, window = 14) {
  const reqs = account.requirements ?? {};
  const due = (reqs.currently_due ?? []).filter(Boolean);
  const left = daysLeft(reqs, now);

  if (left === null) {
    if (due.length) {
      return ['undated',
        `${due.length} field(s) currently due with no deadline set yet: real work, ` +
        'no date to plan it around'];
    }
    return ['clear', 'no deadline and nothing currently due'];
  }

  const when = cohortDay(reqs.current_deadline);

  if (left < 0) {
    if (due.length) {
      return ['enforced',
        `deadline passed ${-left} day(s) ago on ${when} with ${due.length} field(s) ` +
        'still due: these have moved into past_due and the capability is already off'];
    }
    return ['passed', `deadline passed on ${when} with nothing outstanding: it was met`];
  }

  if (!due.length) {
    return ['verifying',
      `deadline ${when} in ${left} day(s) with nothing currently due: Stripe is ` +
      'checking what it already has, so there is nothing to collect'];
  }

  const detail = `${left} day(s) left, due ${when}, ${due.length} field(s): ` +
    due.slice(0, 4).join(', ');
  return [left <= window ? 'urgent' : 'scheduled', detail];
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

  const now = Math.floor(Date.now() / 1000);
  const windowDays = 14;
  const counts = new Map();
  const rows = [];
  let scanned = 0;

  for await (const acct of accounts(key)) {
    scanned += 1;
    const [state, detail] = horizon(acct, now, windowDays);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'clear' || state === 'passed') continue;
    const reqs = acct.requirements ?? {};
    rows.push({
      left: daysLeft(reqs, now),
      day: cohortDay(reqs.current_deadline),
      id: acct.id ?? 'acct_?',
      state,
      detail,
    });
  }

  // Nearest deadline first; undated accounts last, since they are work you know
  // about with a date you do not.
  rows.sort((a, b) => (a.left === null) - (b.left === null) || a.left - b.left);
  for (const r of rows) console.warn(`${r.id}  ${r.state.padEnd(10)} ${r.detail}`);

  const calendar = new Map();
  for (const r of rows) {
    if (r.day && (r.state === 'urgent' || r.state === 'scheduled')) {
      calendar.set(r.day, (calendar.get(r.day) ?? 0) + 1);
    }
  }

  const enforced = counts.get('enforced') ?? 0;
  const urgent = counts.get('urgent') ?? 0;
  const undated = counts.get('undated') ?? 0;

  console.log(`${scanned} account(s): ${enforced} enforced, ${urgent} inside ` +
    `${windowDays} days, ${counts.get('scheduled') ?? 0} scheduled across ` +
    `${calendar.size} date(s)`);
  for (const day of [...calendar.keys()].sort()) {
    console.log(`  ${day}  ${calendar.get(day)} account(s) fall due together`);
  }

  if (enforced) {
    console.warn('  the enforced accounts are already disabled: read past_due, not ' +
                 'currently_due, and treat them as an incident');
  }
  if (urgent || counts.get('scheduled')) {
    console.warn('  repair: for each account, create an onboarding link and email it:');
    console.warn(`  POST ${API}/account_links with account={id}, ` +
                 'type=account_onboarding, refresh_url, return_url,');
    console.warn('  collection_options[fields]=eventually_due  ' +
                 '(eventually_due, so the account does not come back next quarter)');
  }
  if (undated) {
    console.warn('  the undated accounts have fields due and no deadline yet: ' +
                 'collect now rather than waiting for a date to appear');
  }
  if (enforced || urgent || undated) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
