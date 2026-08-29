/**
 * Report Stripe draft invoices that will never finalize on their own.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Stripe finalizes about an hour after invoice.created is acknowledged, and
// defers up to 72 hours while endpoints are failing. Anything still a draft well
// past that is not waiting for the workflow, it is outside it.
export const STALE_DAYS = 30;

/**
 * Classify one draft invoice. Pure, so the rules can be tested without a network.
 * `finalizesInDays` is negative when that moment has passed, null when the field is.
 */
export function verdict(ageDays, autoAdvance, finalizesInDays, amountDue) {
  if (ageDays < STALE_DAYS) {
    return ['fresh',
      `draft for ${ageDays.toFixed(1)} day(s); still inside the window where ` +
      'Stripe finalizes on its own'];
  }
  if (!amountDue) {
    return ['empty',
      `draft for ${ageDays.toFixed(0)} day(s) with amount_due 0: clutter rather ` +
      'than money, and safe to delete'];
  }
  if (!autoAdvance) {
    return ['stranded',
      `auto_advance is false after ${ageDays.toFixed(0)} day(s): no finalization ` +
      'is scheduled and none will be'];
  }
  if (finalizesInDays === null || finalizesInDays === undefined) {
    return ['unscheduled',
      `auto_advance is true after ${ageDays.toFixed(0)} day(s) but ` +
      'automatically_finalizes_at is null: nothing is queued'];
  }
  if (finalizesInDays < 0) {
    return ['blocked',
      `the scheduled finalization passed ${(-finalizesInDays).toFixed(1)} day(s) ` +
      'ago and this is still a draft: read last_finalization_error'];
  }
  return ['scheduled',
    `finalizes in ${finalizesInDays.toFixed(1)} day(s); leave it alone`];
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

export async function drafts(key, olderThanDays = STALE_DAYS, limit = 2000) {
  const cutoff = Math.floor(Date.now() / 1000 - olderThanDays * 86400);
  const out = [];
  const params = { status: 'draft', limit: 100, 'created[lt]': cutoff };
  for (;;) {
    const page = await get(key, '/invoices', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const olderThan = Number(process.argv[2] ?? STALE_DAYS);
  const now = Date.now() / 1000;
  const rows = (await drafts(key, olderThan)).map((inv) => {
    const created = inv.created ?? now;
    const at = inv.automatically_finalizes_at;
    return {
      id: inv.id ?? '<no id>',
      amount: inv.amount_due ?? 0,
      currency: (inv.currency ?? '').toUpperCase(),
      state: verdict((now - created) / 86400,
        Boolean(inv.auto_advance),
        at === null || at === undefined ? null : (at - now) / 86400,
        inv.amount_due ?? 0),
    };
  });

  const stuck = rows.filter((r) => ['stranded', 'unscheduled', 'blocked'].includes(r.state[0]));
  if (stuck.length === 0) {
    console.log(`${'clear'.padEnd(11)} 0 draft invoice(s) older than ${olderThan} days`);
    return;
  }

  const atStake = stuck.reduce((a, r) => a + r.amount, 0);
  console.warn(`${'stuck'.padEnd(11)} ${stuck.length} stuck draft(s) worth ${atStake} in minor units`);
  for (const r of stuck.slice(0, 20)) {
    const [state, detail] = r.state;
    console.warn(`  ${state.padEnd(11)} ${r.id}  ${r.amount} ${r.currency}  ${detail}`);
    if (state === 'blocked') {
      console.warn(`      GET ${API}/invoices/${r.id}  and read last_finalization_error`);
    } else {
      console.warn(`      POST ${API}/invoices/${r.id}/finalize   to bill it`);
      console.warn(`      POST ${API}/invoices/${r.id}  auto_advance=true   to hand it back to Stripe`);
    }
  }
  if (stuck.length > 20) console.warn(`  ... and ${stuck.length - 20} more`);
  console.warn('  drafts you never intended to bill are the one kind of invoice ' +
               'Stripe lets you remove; do that in a separate pass');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
