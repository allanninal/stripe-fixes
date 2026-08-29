/**
 * Report Stripe charges Radar scored as highest risk that succeeded anyway.
 *
 * Read only. Paginated GETs and nothing else: give this a RESTRICTED key with
 * read access to Charges, Disputes and Radar. The repair is printed, never run.
 */
const API = 'https://api.stripe.com/v1';

const LEAKING = new Set(['allowed', 'leaked', 'uncaptured']);

/**
 * Classify one charge. Pure, so the precedence rules can be tested offline.
 * `rule` is outcome.rule: null, a rule id, or the expanded rule object.
 */
export function verdict(riskLevel, status, captured, rule) {
  if (riskLevel === null || riskLevel === undefined || riskLevel === 'not_assessed') {
    return ['not_assessed',
      'Radar never scored this charge: no Radar session reached the API'];
  }
  if (riskLevel !== 'highest') {
    return ['baseline', `risk_level ${riskLevel}, outside the scope of this check`];
  }
  if (status !== 'succeeded') {
    return ['stopped', `highest risk and status ${status}: the block held`];
  }
  if (!captured) {
    return ['uncaptured',
      'highest risk, authorized but not captured: cancel the payment intent ' +
      'before the hold is captured or expires'];
  }
  const action = rule && typeof rule === 'object' ? rule.action : null;
  if (action === 'allow') {
    const predicate = (rule.predicate ?? rule.id) || 'unnamed';
    return ['allowed',
      `highest risk and captured because an allow rule matched first: ${predicate}`];
  }
  return ['leaked',
    'highest risk and captured with no rule named: the built-in highest risk ' +
    'block rule is not in force on this account'];
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

async function fraudChargeIds(key, cap) {
  const ids = new Set();
  const idOf = (c) => (typeof c === 'string' ? c : c?.id);
  for (const efw of await page(key, '/radar/early_fraud_warnings', cap)) {
    if (efw.charge) ids.add(idOf(efw.charge));
  }
  for (const dispute of await page(key, '/disputes', cap)) {
    if (dispute.charge) ids.add(idOf(dispute.charge));
  }
  ids.delete(undefined);
  return ids;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number((process.env.DAYS || "dummy-days") ?? 90);
  const since = Math.floor(Date.now() / 1000 - days * 86400);
  const charges = await page(key, '/charges', 5000, { 'created[gte]': since });

  const leaking = [];
  const counts = {};
  for (const ch of charges) {
    const outcome = ch.outcome ?? {};
    const [state, detail] = verdict(outcome.risk_level, ch.status, ch.captured,
                                    outcome.rule);
    counts[state] = (counts[state] ?? 0) + 1;
    if (LEAKING.has(state)) leaking.push([ch, state, detail]);
  }

  const captured = (counts.allowed ?? 0) + (counts.leaked ?? 0);
  console.log(`${charges.length} charge(s): ${captured} highest-risk captured, ` +
              `${counts.stopped ?? 0} stopped`);
  if (counts.not_assessed) {
    console.warn(`${counts.not_assessed} charge(s) were never scored by Radar. Mount ` +
                 'Stripe.js on the payment page, or pass radar_options[session] on ' +
                 'server-side confirms, before tuning any rule.');
  }

  if (leaking.length === 0) {
    if (counts.not_assessed) process.exitCode = 1;
    return;
  }

  const fraud = await fraudChargeIds(key, 1000);
  let hits = 0;
  for (const [ch, state, detail] of leaking) {
    let marker = '';
    if (fraud.has(ch.id)) {
      hits += 1;
      marker = '  [early fraud warning or dispute on this charge]';
    }
    console.warn(`${state.padEnd(12)} ${ch.id} ${detail}${marker}`);
  }

  console.warn(`  ${hits} of ${leaking.length} leaked charge(s) already carry fraud evidence`);
  console.warn("  guard every allow rule in Dashboard, Radar, Rules by appending " +
               "and :risk_level: != 'highest' to its predicate");
  console.warn("  then confirm the built-in rule if :risk_level: = 'highest' is still enabled");
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
