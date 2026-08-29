/**
 * Report Stripe early fraud warnings that can still be refunded.
 *
 * Read only. GETs only, no writes: give this a RESTRICTED key with read access
 * to Early Fraud Warnings and Charges. The refund is printed, never issued,
 * because a refund cannot be undone.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one warning against its charge. Pure. Returns [state, detail].
 * `charge` is the charge the warning names, or null if it could not be read.
 */
export function classify(efw, charge, now) {
  if (!efw.actionable) {
    return ['not_actionable',
      'Stripe no longer counts this as actionable: it has already been ' +
      'disputed or fully refunded'];
  }
  if (charge === null || charge === undefined) {
    return ['unknown', 'the charge named by this warning could not be read'];
  }

  if (charge.disputed) {
    return ['escalated',
      'the warning became a dispute. The refund window is closed, the dispute ' +
      'fee applies, and it now counts twice toward the ratio.'];
  }

  const amount = charge.amount ?? 0;
  const refunded = charge.amount_refunded ?? 0;
  if (charge.refunded || (amount && refunded >= amount)) {
    return ['refunded', 'fully refunded before it could escalate'];
  }
  if (refunded) {
    return ['partial',
      `${refunded} of ${amount} refunded. A partial refund does not close the ` +
      'window: the warning is still actionable and can still become a dispute.'];
  }

  const created = efw.created;
  if (created === undefined || created === null) {
    return ['actionable', 'unrefunded, with no created timestamp to age it by'];
  }
  const days = (now - created) / 86400;
  return ['actionable',
    `${days.toFixed(1)} day(s) old, ${amount} ` +
    `${(charge.currency ?? '?').toUpperCase()} unrefunded, no dispute filed yet`];
}

async function get(key, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

export async function* warnings(key, since, limit = 1000) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': Math.floor(since) };
  for (;;) {
    const page = await get(key, '/radar/early_fraud_warnings', params);
    const data = page?.data ?? [];
    for (const w of data) { yield w; seen += 1; }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
}

/** The warning carries `charge` as an id, or expanded as an object. */
export function chargeId(efw) {
  const ch = efw.charge;
  return ch && typeof ch === 'object' ? ch.id : ch;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = process.argv.includes('--days')
    ? Number(process.argv[process.argv.indexOf('--days') + 1]) : 90;

  const now = Date.now() / 1000;
  const since = now - days * 86400;
  const types = new Map();
  const rows = [];
  let seen = 0;

  for await (const w of warnings(key, since)) {
    seen += 1;
    const t = w.fraud_type ?? 'unknown';
    types.set(t, (types.get(t) ?? 0) + 1);
    const cid = chargeId(w);
    const charge = w.actionable && cid ? await get(key, `/charges/${cid}`) : null;
    const [state, detail] = classify(w, charge, now);
    if (['actionable', 'partial', 'unknown'].includes(state)) {
      rows.push([w.created ?? 0, w, cid, state, detail]);
    }
  }

  rows.sort((a, b) => a[0] - b[0]);
  for (const [, w, cid, state, detail] of rows) {
    console.warn(`${state.padEnd(12)} ${w.id ?? '?'}  charge=${cid}  ` +
                 `${w.fraud_type ?? '?'}  ${detail}`);
    if (state === 'unknown') continue;
    console.warn(`  repair: POST ${API}/refunds -d charge=${cid} -d reason=fraudulent`);
    console.warn('  or Dashboard, the payment, Refund as fraud, which also adds ' +
                 'the card fingerprint and email to your block lists');
  }

  console.log(`${seen} warning(s) read, ${rows.length} actionable and unrefunded`);
  const ranked = [...types.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    console.log('by fraud_type: ' + ranked.map(([k, v]) => `${k}=${v}`).join(', '));
    const [top, count] = ranked[0];
    if (seen && count >= 10 && count / seen > 0.5) {
      console.warn(`${count} of ${seen} warnings are ${top}: that is a campaign, ` +
                   `and a Radar rule will do more than ${count} refunds`);
    }
  }
  console.log('subscribe to radar.early_fraud_warning.created so this sweep is a ' +
              'backstop rather than the only notice you get');
  process.exitCode = rows.length ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
