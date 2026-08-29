/**
 * Report Stripe customers whose cards are still in the legacy sources store.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Customers and PaymentMethods. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Cards saved before the PaymentMethods API. `src_` covers the Sources API that
// briefly sat between the two; neither is visible to GET /v1/payment_methods.
const LEGACY_PREFIXES = ['card_', 'src_'];

/**
 * Sort one customer by which card store actually holds their card. Pure, so the
 * states can be tested without a network. Returns [state, detail].
 */
export function classify(customer, sources, paymentMethods) {
  const legacy = (sources ?? []).filter(
    (s) => LEGACY_PREFIXES.some((p) => String(s.id ?? '').startsWith(p)));
  const modern = paymentMethods ?? [];
  const defaultSource = customer.default_source ?? null;
  const defaultPm = (customer.invoice_settings ?? {}).default_payment_method ?? null;

  if (legacy.length === 0 && modern.length > 0) {
    if (!defaultPm) {
      return ['no_default',
        `${modern.length} PaymentMethod(s) and no invoice_settings.` +
        'default_payment_method: Billing has nothing to fall back to'];
    }
    return ['modern', `${modern.length} PaymentMethod(s), modern default set`];
  }

  if (legacy.length === 0 && modern.length === 0) {
    return ['cardless',
      "no card in either store: this is the other cause of 'cannot charge a " +
      "customer that has no active card'"];
  }

  if (modern.length === 0) {
    if (defaultSource) {
      return ['split_brain',
        `${legacy.length} legacy source(s) and default_source set, but no ` +
        'PaymentMethod at all: every modern code path sees this customer as ' +
        'having no card'];
    }
    return ['legacy_only',
      `${legacy.length} legacy source(s) and no PaymentMethod: charged only by ` +
      'code that still reads customer.sources'];
  }

  if (!defaultPm) {
    return ['split_default',
      `${legacy.length} legacy source(s) alongside ${modern.length} ` +
      'PaymentMethod(s), but default_payment_method is null: Billing falls back ' +
      'to default_source and renews on the legacy card'];
  }

  return ['residue',
    `${legacy.length} legacy source(s) left behind a completed migration: the ` +
    'modern default is set, so these are safe to remove'];
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

export async function* customers(key, cap = 5000) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/customers', params);
    const data = page.data ?? [];
    for (const cust of data) {
      yield cust;
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

  const counts = {};
  let scanned = 0;
  for await (const cust of customers(key)) {
    scanned += 1;
    const srcs = (await get(key, `/customers/${cust.id}/sources`,
                            { object: 'card', limit: 100 })).data ?? [];

    // Skip the second call for the healthy majority: no legacy source plus a
    // modern default is already migrated, whatever the PaymentMethod list says.
    const defaultPm = (cust.invoice_settings ?? {}).default_payment_method ?? null;
    let pms = [];
    if (srcs.length || !defaultPm) {
      pms = (await get(key, '/payment_methods',
                       { customer: cust.id, type: 'card', limit: 100 })).data ?? [];
    }

    const [state, detail] = classify(cust, srcs, pms);
    counts[state] = (counts[state] ?? 0) + 1;
    if (state !== 'modern') {
      console.warn(`${cust.id ?? 'cus_?'}  ${state.padEnd(14)} ${detail}`);
    }
  }

  const split = (counts.split_brain ?? 0) + (counts.split_default ?? 0);
  const legacyOnly = counts.legacy_only ?? 0;
  const cardless = counts.cardless ?? 0;

  console.log(`${scanned} customer(s): ${counts.modern ?? 0} modern, ` +
              `${legacyOnly} legacy-only, ${split} split, ${cardless} cardless`);

  if (legacyOnly || split || counts.residue) {
    console.warn('  repair, in this order, per customer:');
    console.warn('  1. create a PaymentMethod from the legacy card, or send the ' +
                 'customer through a SetupIntent to re-add it');
    console.warn(`  2. POST ${API}/customers/{id} with ` +
                 'invoice_settings[default_payment_method]=pm_...');
    console.warn(`  3. only then remove the old object at ` +
                 `${API}/customers/{id}/sources/{card_id}`);
  }
  if (cardless) {
    console.warn(`  ${cardless} customer(s) have no card in either store: a ` +
                 'SetupIntent is the only repair, and it collects the mandate too');
  }
  if (scanned - (counts.modern ?? 0)) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
