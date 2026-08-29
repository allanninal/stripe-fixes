/**
 * Report metered subscription items that no usage has been recorded against.
 *
 * Read only. Three GETs, no writes: give this a RESTRICTED key with read access
 * to Subscriptions, Billing Meters and Invoices. The repair is printed, never
 * performed, because this script holds a credential to a live payments account.
 */
const API = 'https://api.stripe.com/v1';

// A period that opened minutes ago has no usage yet on almost any product, and
// reporting that as a fault trains people to ignore the check on the 1st.
export const GRACE_HOURS = 6;

/**
 * Classify one metered subscription item. Pure, so the rules can be tested.
 * Returns [state, detail].
 */
export function verdict(aggregatedValue, summaryRows, hoursIntoPeriod, zeroBilledCycles) {
  if (aggregatedValue) {
    return ['reporting', `${aggregatedValue.toLocaleString('en-US')} unit(s) so far this period`];
  }
  if (hoursIntoPeriod < GRACE_HOURS) {
    return ['early',
      `the period is ${hoursIntoPeriod.toFixed(1)}h old; too early to call zero a fault`];
  }

  let cause;
  let state;
  if (summaryRows) {
    cause = `${summaryRows} summary row(s) and every one aggregates to 0: the events ` +
            'arrive and carry no value. Check value_settings.event_payload_key ' +
            'against the payload.';
    state = 'zero-valued';
  } else {
    cause = 'no meter event summaries at all for this customer: the events never ' +
            'matched. Check event_name first, then customer_mapping.event_payload_key.';
    state = 'silent';
  }

  if (zeroBilledCycles) {
    return ['billed-zero',
      `${zeroBilledCycles} closed invoice(s) already billed a zero line. ${cause}`];
  }
  return [state, cause];
}

async function get(key, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (res.status === 403) {
    throw new Error(`403 from Stripe: the restricted key lacks read access to ${path}`);
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

async function* paginate(key, path, params = {}) {
  const p = { limit: 100, ...params };
  for (;;) {
    const page = await get(key, path, p);
    const data = page.data ?? [];
    for (const row of data) yield row;
    if (data.length === 0 || !page.has_more) return;
    p.starting_after = data[data.length - 1].id;
  }
}

/**
 * Current period for an item. These fields moved from the subscription onto each
 * item, because items on one subscription can now bill on different cycles.
 */
export function periodBounds(sub, item) {
  return [item.current_period_start ?? sub.current_period_start,
          item.current_period_end ?? sub.current_period_end];
}

async function usage(key, meterId, customer, start, end) {
  const hour = 3600;
  const page = await get(key, `/billing/meters/${meterId}/event_summaries`, {
    customer,
    start_time: Math.floor(start / hour) * hour,
    end_time: Math.floor(end / hour) * hour,
    limit: 100,
  });
  let rows = 0;
  let total = 0;
  for (const row of page.data ?? []) {
    rows += 1;
    total += row.aggregated_value ?? 0;
  }
  return { rows, total };
}

async function zeroBilled(key, subscriptionId, lookBack) {
  let count = 0;
  for await (const inv of paginate(key, '/invoices',
    { subscription: subscriptionId, status: 'paid', limit: lookBack })) {
    if ((inv.lines?.data ?? []).some((line) => (line.amount ?? 0) === 0)) count += 1;
    if (count >= lookBack) break;
  }
  return count;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const lookBack = 6;
  const now = Math.floor(Date.now() / 1000);
  let findings = 0;
  let checked = 0;

  for await (const sub of paginate(key, '/subscriptions',
    { status: 'active', 'expand[]': 'data.items.data.price' })) {
    for (const item of sub.items?.data ?? []) {
      const recurring = item.price?.recurring ?? {};
      if (recurring.usage_type !== 'metered') continue;
      const meterId = recurring.meter;
      if (!meterId) {
        console.warn(`legacy      ${sub.id} / ${item.id}  metered price ` +
          `${item.price?.id} has no meter; match it against GET ${API}/billing/meters by hand`);
        continue;
      }

      checked += 1;
      const [start, end] = periodBounds(sub, item);
      if (!start) continue;
      const { rows, total } = await usage(key, meterId, sub.customer, start, end ?? now);
      const hours = Math.max(0, (now - start) / 3600);
      const zeros = total ? 0 : await zeroBilled(key, sub.id, lookBack);
      const [state, detail] = verdict(total, rows, hours, zeros);

      const line = `${state.padEnd(11)} ${sub.id} / ${item.id}  meter ${meterId}: ${detail}`;
      if (state === 'reporting' || state === 'early') { console.log(line); continue; }

      findings += 1;
      console.warn(line);
      console.warn('  compare the emitter payload with the meter definition:');
      console.warn(`  GET ${API}/billing/meters/${meterId}`);
      console.warn('  then backfill this period before its invoice finalizes; ' +
                   'usage cannot be added to a finalized invoice');
    }
  }

  console.log(`checked ${checked} metered item(s), ${findings} not reporting`);
  if (findings) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
