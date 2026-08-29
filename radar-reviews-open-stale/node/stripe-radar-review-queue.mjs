/**
 * Report Stripe Radar reviews left open while the funds behind them are at risk.
 *
 * Read only. Paginated GETs and nothing else: give this a RESTRICTED key with
 * read access to Reviews and Charges. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const STALE_DAYS = 3;  // past this the queue is a backlog, not a queue
export const LAPSE_DAYS = 7;  // an uncaptured authorization is released at this age
const MIN_CLOSED = 20;
const OVERBROAD = 0.95;
const WIDE = 0.8;

/**
 * Classify one open review. Pure, so both deadlines can be tested offline.
 * `captured` is the charge's captured flag, or null when it could not be read.
 */
export function verdict(ageDays, captured) {
  if (ageDays < STALE_DAYS) {
    return ['open',
      `open for ${ageDays.toFixed(1)} day(s), still inside the window Stripe asks you to work`];
  }
  if (captured === false && ageDays >= LAPSE_DAYS) {
    return ['lapsed',
      `open for ${ageDays.toFixed(1)} day(s) on an uncaptured authorization: the hold ` +
      `was released at ${LAPSE_DAYS} days and approving it now captures nothing`];
  }
  if (captured === false) {
    return ['expiring',
      `open for ${ageDays.toFixed(1)} day(s) on an uncaptured authorization, released ` +
      `in ${(LAPSE_DAYS - ageDays).toFixed(1)} day(s)`];
  }
  if (ageDays >= LAPSE_DAYS) {
    return ['critical',
      `open for ${ageDays.toFixed(1)} day(s) on a captured charge: the money is with ` +
      'you and the dispute window is already running'];
  }
  return ['stale', `open for ${ageDays.toFixed(1)} day(s) on a captured charge`];
}

/** Judge the review rule from how its reviews were closed. Pure. */
export function ruleHealth(approved, closed) {
  if (closed < MIN_CLOSED) {
    return ['insufficient', `${closed} closed review(s) is too few to judge the rule`];
  }
  const rate = approved / closed;
  const pct = Math.round(rate * 100);
  if (rate >= OVERBROAD) {
    return ['overbroad',
      `${pct}% of closed reviews were approved: the rule flags traffic you always ` +
      'accept and has never changed an outcome'];
  }
  if (rate >= WIDE) {
    return ['wide', `${pct}% approved: add a second predicate before staffing this queue`];
  }
  return ['earning', `${pct}% approved: the rule is catching real fraud`];
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

async function capturedFlag(key, chargeId, cache) {
  if (!chargeId) return null;
  if (!(chargeId in cache)) {
    try {
      cache[chargeId] = (await get(key, `/charges/${chargeId}`)).captured ?? null;
    } catch {
      cache[chargeId] = null;
    }
  }
  return cache[chargeId];
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number((process.env.DAYS || "dummy-days") ?? 90);
  const now = Date.now() / 1000;
  const since = now - days * 86400;
  const reviews = await page(key, '/reviews', 2000);

  const cache = {};
  const byReason = {};
  let approved = 0;
  let closed = 0;
  let flagged = 0;

  for (const rev of reviews) {
    const created = rev.created ?? now;
    if (created >= since && rev.closed_reason) {
      closed += 1;
      if (rev.closed_reason === 'approved') approved += 1;
    }
    if (!rev.open) continue;
    const reason = rev.opened_reason ?? 'unknown';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    const age = (now - created) / 86400;
    const [state, detail] = verdict(age, await capturedFlag(key, rev.charge, cache));
    if (state === 'open') {
      console.log(`${state.padEnd(9)} ${rev.id}  ${detail}`);
      continue;
    }
    flagged += 1;
    console.warn(`${state.padEnd(9)} ${rev.id}  ${detail}`);
    console.warn(`    opened by ${reason}, charge ${rev.charge}`);
  }

  for (const [reason, n] of Object.entries(byReason).sort()) {
    console.log(`${n} open review(s) opened by ${reason}`);
  }
  const [health, detail] = ruleHealth(approved, closed);
  console.log(`${health.padEnd(12)} ${detail}`);

  if (!flagged && health !== 'overbroad' && health !== 'wide') {
    console.log(`0 open review(s) past ${STALE_DAYS} days`);
    return;
  }
  if (flagged) {
    console.warn('  work the queue: Dashboard, Radar, Reviews, then Approve, Refund, ' +
                 'or Refund and report fraud on each one');
    console.warn('  alert instead of polling: subscribe an endpoint to review.opened');
  }
  if (health === 'overbroad' || health === 'wide') {
    console.warn('  narrow the rule in Dashboard, Radar, Rules: add a second predicate, ' +
                 'for example is_disposable_email alongside the card_funding test, or ' +
                 'delete the rule outright');
  }
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
