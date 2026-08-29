/**
 * Report open Stripe invoices past their due_date with nothing chasing them.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Invoices. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const ACTION_DAYS = 30;             // earliest past-due subscription action
export const REMINDER_END_DAYS = 60; // past this, no built-in reminder is sent

/**
 * Classify one open invoice. Pure, so the boundaries can be tested without a network.
 * `daysOverdue` is negative within terms and null when there is no due_date.
 */
export function verdict(daysOverdue, amountRemaining) {
  if (!amountRemaining || amountRemaining <= 0) {
    return ['nothing_due', 'open with amount_remaining 0: no money outstanding'];
  }
  if (daysOverdue === null || daysOverdue === undefined) {
    return ['undated',
      'open with no due_date: it can never be overdue, so no reminder will ever fire for it'];
  }
  if (daysOverdue < 0) {
    return ['current', `due in ${(-daysOverdue).toFixed(1)} day(s)`];
  }
  if (daysOverdue < ACTION_DAYS) {
    return ['overdue',
      `${daysOverdue.toFixed(0)} day(s) past due; still inside the reminder window`];
  }
  if (daysOverdue < REMINDER_END_DAYS) {
    return ['stale',
      `${daysOverdue.toFixed(0)} day(s) past due; past the point where a ` +
      'subscription action would have fired had one been configured'];
  }
  return ['abandoned',
    `${daysOverdue.toFixed(0)} day(s) past due; beyond every built-in reminder, ` +
    'so nothing automated will chase this one again'];
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

export async function openInvoices(key, limit = 2000) {
  const out = [];
  const params = { status: 'open', collection_method: 'send_invoice', limit: 100 };
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

  const now = Date.now() / 1000;
  const rows = (await openInvoices(key)).map((inv) => {
    const remaining = inv.amount_remaining ?? 0;
    const due = inv.due_date;
    return {
      id: inv.id ?? '<no id>',
      amount: remaining,
      currency: (inv.currency ?? '').toUpperCase(),
      state: verdict(due === null || due === undefined ? null : (now - due) / 86400, remaining),
    };
  });

  const late = rows.filter((r) => ['overdue', 'stale', 'abandoned', 'undated'].includes(r.state[0]));
  if (late.length === 0) {
    console.log(`${'clear'.padEnd(12)} 0 open invoice(s) past due_date`);
    return;
  }

  // Biggest balance first: the oldest invoice is rarely the one worth a call.
  late.sort((a, b) => b.amount - a.amount);
  const outstanding = late.reduce((a, r) => a + r.amount, 0);
  console.warn(`${'receivable'.padEnd(12)} ${late.length} unchased invoice(s) worth ${outstanding} in minor units`);
  for (const r of late.slice(0, 20)) {
    const [state, detail] = r.state;
    console.warn(`  ${state.padEnd(12)} ${r.id}  ${r.amount} ${r.currency}  ${detail}`);
  }
  if (late.length > 20) console.warn(`  ... and ${late.length - 20} more`);
  console.warn('  turn the follow-up on first: Dashboard, Settings, Billing, ' +
               'Invoices, then enable reminder emails and the past-due subscription action');
  console.warn(`  then per invoice: POST ${API}/invoices/<id>/send to re-send, or ` +
               'mark_uncollectible on the ones nobody will pay');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
