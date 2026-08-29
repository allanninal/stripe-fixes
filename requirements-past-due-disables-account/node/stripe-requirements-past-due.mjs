/**
 * Separate connected accounts that are already disabled from ones merely due.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// A deadline further out than this is a scheduled task; inside it, an email today.
export const NEAR_DEADLINE_DAYS = 14;

/**
 * Sort one account's requirements object. Pure, so the nesting can be tested.
 * eventually_due contains currently_due contains past_due, so the arrays are read
 * innermost first. Returns [state, detail].
 */
export function classify(requirements, now, nearDays = NEAR_DEADLINE_DAYS) {
  const reqs = requirements ?? {};
  const past = (reqs.past_due ?? []).filter(Boolean);
  const current = (reqs.currently_due ?? []).filter(Boolean);
  const pending = (reqs.pending_verification ?? []).filter(Boolean);
  const eventual = (reqs.eventually_due ?? []).filter(Boolean);
  const deadline = reqs.current_deadline;

  if (past.length) {
    return ['past-due',
      `${past.length} field(s) past the deadline, so the capabilities that need ` +
      `them are already off: ${past.slice(0, 4).join(', ')}`];
  }

  if (current.length) {
    if (typeof deadline === 'number') {
      const days = (deadline - now) / 86400;
      if (days < 0) {
        return ['overdue',
          `current_deadline passed ${(-days).toFixed(1)} days ago with ` +
          `${current.length} field(s) still due: expect past_due next`];
      }
      if (days <= nearDays) {
        return ['deadline',
          `${current.length} field(s) due and current_deadline is ` +
          `${days.toFixed(1)} days away: ${current.slice(0, 4).join(', ')}`];
      }
      return ['due',
        `${current.length} field(s) due, ${days.toFixed(1)} days of deadline left`];
    }
    return ['due', `${current.length} field(s) currently due with no deadline set yet`];
  }

  if (pending.length) {
    return ['pending',
      `${pending.length} field(s) submitted and under verification: nothing to collect`];
  }

  if (eventual.length) {
    return ['eventual', `${eventual.length} field(s) eventually due, none of them urgent`];
  }

  return ['clear', 'no outstanding requirements'];
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

  const nearDays = Number((process.env.NEAR_DAYS || "dummy-near-days") ?? NEAR_DEADLINE_DAYS);
  const now = Math.floor(Date.now() / 1000);
  const counts = new Map();
  const urgent = [];
  let scanned = 0;

  for await (const acct of accounts(key)) {
    scanned += 1;
    const [state, detail] = classify(acct.requirements, now, nearDays);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (['past-due', 'overdue', 'deadline'].includes(state)) {
      urgent.push([acct.requirements?.current_deadline ?? 0, acct.id ?? 'acct_?',
        state, detail, acct.payouts_enabled]);
    }
  }

  // Soonest deadline first: this list is a work queue, not a report.
  for (const [, id, state, detail, payouts] of urgent.sort((a, b) => a[0] - b[0])) {
    console.warn(`${id}  ${state.padEnd(9)} payouts_enabled=${payouts}  ${detail}`);
  }

  const broken = (counts.get('past-due') ?? 0) + (counts.get('overdue') ?? 0);
  const soon = counts.get('deadline') ?? 0;
  console.log(`${scanned} account(s): ${broken} past due, ${soon} with a deadline ` +
              `inside ${nearDays} days`);

  if (broken) {
    console.warn('  repair: per-capability detail first, since the account level ' +
                 'arrays flatten several capabilities together:');
    console.warn(`  GET ${API}/accounts/{id}/capabilities`);
    console.warn('  repair: update the account with every string listed in ' +
                 'requirements.past_due, or send an onboarding account link');
  }
  if (soon || counts.get('due')) {
    console.warn('  repair: collect eventually_due rather than currently_due so the ' +
                 'account does not re-enter this state at the next threshold');
  }
  if (broken || soon) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
