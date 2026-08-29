/**
 * Report a Stripe account where Radar blocks too large a share of attempts.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Charges. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const HIGH_RATE = 0.05;      // one attempt in twenty stopped before the issuer saw it
const WATCH_RATE = 0.02;     // worth a look before it becomes a conversion problem
const DOMINANT = 0.5;        // one predicate causing at least half of the blocks
const MOSTLY_NORMAL = 0.8;   // and those charges scoring normal risk, not elevated

/**
 * Classify one window of charge attempts. Pure, so the thresholds are testable.
 * `topRule` is [predicate, blockedCount, normalRiskCount] or null.
 */
export function verdict(total, blocked, adaptive = 0, topRule = null) {
  if (!total) return ['no-data', 'no charge attempts in the window'];
  if (!blocked) return ['normal', `no blocked charges in ${total} attempt(s)`];

  const own = Math.max(blocked - adaptive, 0);
  if (!own) {
    return ['adaptive-only',
      `${blocked} of ${total} attempt(s) blocked ` +
      `(${(100 * blocked / total).toFixed(1)}%), every one of them ` +
      'low_probability_of_authorization: that is Adaptive Acceptance skipping a ' +
      'decline, not a rule of yours'];
  }

  const pct = (100 * own / total).toFixed(1);
  if (own / total >= HIGH_RATE) {
    if (topRule) {
      const [predicate, count, normal] = topRule;
      if (count >= DOMINANT * own && count && normal >= MOSTLY_NORMAL * count) {
        return ['overblocking-rule',
          `${own} of ${total} attempt(s) blocked (${pct}%), and ${count} of those ` +
          `came from one predicate (${predicate}) on charges Radar scored normal risk`];
      }
    }
    return ['elevated',
      `${own} of ${total} attempt(s) blocked by rules or risk (${pct}%), spread ` +
      'across predicates: check the risk threshold as well as the rules'];
  }
  if (own / total >= WATCH_RATE) {
    return ['watch',
      `${own} of ${total} attempt(s) blocked by rules or risk (${pct}%). Track it ` +
      'as a series; a step change dates the rule edit.'];
  }
  return ['normal',
    `${own} of ${total} attempt(s) blocked by rules or risk (${pct}%)`];
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

export async function scan(key, since, until, cap = 5000) {
  let total = 0; let blocked = 0; let adaptive = 0;
  const perRule = new Map();
  const params = {
    'created[gte]': since, 'created[lt]': until, limit: 100,
    'expand[]': 'data.outcome.rule',
  };
  for (;;) {
    const page = await get(key, '/charges', params);
    const data = page.data ?? [];
    for (const charge of data) {
      total += 1;
      const outcome = charge.outcome ?? {};
      if (outcome.type !== 'blocked') continue;
      blocked += 1;
      if (outcome.reason === 'low_probability_of_authorization') { adaptive += 1; continue; }
      const rule = outcome.rule;
      const predicate = (rule && typeof rule === 'object')
        ? (rule.predicate ?? rule.id ?? '<no predicate>')
        : (rule ?? outcome.reason ?? '<no rule>');
      const [count, normal] = perRule.get(predicate) ?? [0, 0];
      perRule.set(predicate,
        [count + 1, normal + (outcome.risk_level === 'normal' ? 1 : 0)]);
    }
    if (data.length === 0 || !page.has_more || total >= cap) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { total, blocked, adaptive, perRule };
}

export function worst(perRule) {
  let best = null;
  for (const [predicate, [count, normal]] of perRule) {
    if (!best || count > best[1]) best = [predicate, count, normal];
  }
  return best;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number(process.argv[2] ?? 30);
  const now = Math.floor(Date.now() / 1000);
  const span = days * 86400;
  const { total, blocked, adaptive, perRule } = await scan(key, now - span, now);
  const [state, detail] = verdict(total, blocked, adaptive, worst(perRule));

  console.log(`${state.padEnd(17)} ${detail}`);
  if (adaptive) {
    console.log(`  ${adaptive} adaptive block(s) excluded ` +
                '(low_probability_of_authorization)');
  }
  for (const [predicate, [count, normal]] of
       [...perRule].sort((a, b) => b[1][0] - a[1][0]).slice(0, 5)) {
    console.log(`  ${count} blocked  ${normal} at normal risk  ${predicate}`);
  }

  const prev = await scan(key, now - 2 * span, now - span);
  if (prev.total) {
    const prevOwn = Math.max(prev.blocked - prev.adaptive, 0);
    console.log(`  previous window: ${(100 * prevOwn / prev.total).toFixed(1)}% ` +
                'blocked by rules or risk');
  }

  if (state === 'normal' || state === 'no-data' || state === 'adaptive-only') return;
  console.warn('  repair: narrow the predicate in Dashboard > Radar > Rules rather ' +
               "than deleting the rule, e.g. add: and :risk_level: = 'elevated'");
  console.warn('  or convert it to a review rule while you gather data, and check ' +
               'its estimated false positive rate before re-enabling');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
