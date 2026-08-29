/**
 * Report Stripe charges scored elevated risk that were captured with no review.
 *
 * Read only. One paginated GET, no writes: give this a RESTRICTED key with read
 * access to Charges. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one Charge by what happened to an elevated risk score. Pure.
 *
 * Radar's defaults block `highest` and leave `elevated` alone, so an elevated
 * charge is authorized and captured unless a review rule puts it in front of a
 * human. `review` is null both when no such rule exists and on a healthy
 * account, so the surrounding fields decide the verdict rather than that one.
 */
export function verdict(charge) {
  const outcome = charge.outcome ?? {};
  const risk = outcome.risk_level ?? null;

  if (risk === null || risk === 'not_assessed') {
    return ['not_assessed',
      'Radar never scored this charge: no Radar session reached the API, so no ' +
      'rule of any kind could have matched it'];
  }

  if (risk !== 'elevated') {
    return ['baseline', `risk_level ${risk}, outside the scope of this check`];
  }

  if (outcome.type !== 'authorized') {
    return ['stopped',
      `elevated and outcome.type ${JSON.stringify(outcome.type)}: something ` +
      'already stopped it'];
  }

  if (charge.review) {
    return ['reviewed', 'elevated and placed in the manual review queue'];
  }

  if (!charge.captured) {
    return ['uncaptured',
      'elevated and unreviewed, authorized but not captured: this is still a ' +
      'hold and it can be released rather than taken'];
  }

  if (charge.disputed) {
    return ['disputed',
      'elevated, captured with no review in front of it, and already disputed: ' +
      'this one is the bill for the missing rule'];
  }

  return ['straight-through',
    'elevated risk, authorized, captured, and no human ever saw it'];
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

async function* pageCharges(key, since, limit) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': since };
  for (;;) {
    const page = await get(key, '/charges', params);
    const rows = page.data ?? [];
    for (const charge of rows) { yield charge; seen += 1; }
    if (!page.has_more || rows.length === 0 || seen >= limit) break;
    params.starting_after = rows[rows.length - 1].id;
  }
}

const rate = (disputed, total) => (total ? (100 * disputed) / total : 0);

async function main() {
  const days = Number(process.argv[2] ?? 90);

  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const states = new Map();
  const unreviewed = new Map();
  let scanned = 0;
  let normalTotal = 0; let normalDisputed = 0;
  let elevatedTotal = 0; let elevatedDisputed = 0;

  for await (const charge of pageCharges(key, since, 5000)) {
    scanned += 1;
    const [state, detail] = verdict(charge);
    states.set(state, (states.get(state) ?? 0) + 1);

    const risk = (charge.outcome ?? {}).risk_level;
    if (risk === 'normal' && charge.captured) {
      normalTotal += 1;
      if (charge.disputed) normalDisputed += 1;
    } else if (risk === 'elevated' && charge.captured) {
      elevatedTotal += 1;
      if (charge.disputed) elevatedDisputed += 1;
    }

    if (state === 'straight-through' || state === 'disputed' || state === 'uncaptured') {
      const currency = charge.currency ?? '???';
      unreviewed.set(currency, (unreviewed.get(currency) ?? 0) + (charge.amount ?? 0));
      console.warn(`${state.padEnd(16)} ${charge.id ?? '?'}  ${detail}`);
    }
  }

  if (scanned === 0) {
    console.log(`no charges in the last ${days} day(s)`);
    return;
  }

  const summary = [...states.entries()].sort().map(([k, n]) => `${n} ${k}`).join(', ');
  console.log(`${scanned} charge(s) in ${days} day(s): ${summary}`);

  const notAssessed = states.get('not_assessed') ?? 0;
  if (notAssessed > scanned / 2) {
    console.warn(`${notAssessed} of ${scanned} charges are not_assessed: Radar is ` +
      'not scoring this traffic, so fix that before adding any rule');
    console.warn('repair: mount Stripe.js on the payment page, or pass ' +
      'radar_options[session] on server-side confirms');
    process.exitCode = 1;
    return;
  }

  const leaked = (states.get('straight-through') ?? 0) + (states.get('disputed') ?? 0);
  if (!leaked && !(states.get('uncaptured') ?? 0)) {
    console.log('no elevated-risk charge was captured without a review');
    return;
  }

  for (const [currency, amount] of [...unreviewed.entries()].sort()) {
    console.warn(`elevated and unreviewed: ${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`);
  }
  console.warn(
    `dispute rate: elevated ${rate(elevatedDisputed, elevatedTotal).toFixed(2)}% ` +
    `(${elevatedDisputed}/${elevatedTotal}) vs normal ` +
    `${rate(normalDisputed, normalTotal).toFixed(2)}% (${normalDisputed}/${normalTotal})`);
  console.warn("repair: Dashboard, Radar, Rules: add \"Place in review if " +
    ":risk_level: = 'elevated'\", scoped by amount if the queue is too large to work daily");
  console.warn('repair: give the review queue an owner; a queue nobody works ' +
    'expires its own payments and is worse than no queue');
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
