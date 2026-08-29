/**
 * Report Stripe prices left at tax_behavior unspecified, ranked by how live they are.
 *
 * Read only. Four GETs, no writes: give this a RESTRICTED key with read access to
 * Products, Prices and Subscriptions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one active price. Pure, so the rules can be tested offline.
 * Returns [state, detail].
 */
export function verdict(taxBehavior, activeSubscriptions, productTaxCode, automaticTaxInUse) {
  if (taxBehavior === 'unspecified') {
    if (automaticTaxInUse) {
      return ['blocking',
        'unspecified while automatic tax is in use on this account: line items on ' +
        'this price cannot be added to an automatic tax invoice. ' +
        `${activeSubscriptions} active subscription(s).`];
    }
    if (activeSubscriptions) {
      return ['live',
        `unspecified with ${activeSubscriptions} active subscription(s). Setting it ` +
        'means a replacement price and a migration, not an edit.'];
    }
    return ['dormant',
      'unspecified with no active subscriptions. Set it now, while it is still ' +
      'settable and nothing is billing on it.'];
  }
  if (!productTaxCode) {
    return ['no-tax-code',
      `${taxBehavior}, but the product carries no tax_code, so the rate falls back ` +
      'to the account default.'];
  }
  return ['ready', `${taxBehavior}, product tax code ${productTaxCode}`];
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

/** Map product id to tax_code. The tax code can be a string id or an object. */
export async function productTaxCodes(key) {
  const codes = new Map();
  for await (const prod of paginate(key, '/products', { active: 'true' })) {
    const code = prod.tax_code;
    codes.set(prod.id, typeof code === 'object' && code !== null ? code.id : code);
  }
  return codes;
}

async function activeSubscriptionCount(key, priceId, cap) {
  let count = 0;
  for await (const _sub of paginate(key, '/subscriptions',
    { price: priceId, status: 'active' })) {
    count += 1;
    if (count >= cap) break;
  }
  return count;
}

async function automaticTaxInUse(key) {
  const page = await get(key, '/subscriptions',
    { limit: 1, 'automatic_tax[enabled]': 'true' });
  return (page.data ?? []).length > 0;
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const cap = 200;
  const codes = await productTaxCodes(key);
  const autoTax = await automaticTaxInUse(key);
  if (autoTax) {
    console.log('automatic tax is enabled on at least one subscription, so an ' +
      'unspecified price is an active fault rather than a latent one');
  }

  let findings = 0;
  let total = 0;
  for await (const price of paginate(key, '/prices', { active: 'true' })) {
    total += 1;
    const behavior = price.tax_behavior;
    const product = typeof price.product === 'object' && price.product !== null
      ? price.product.id : price.product;
    const subs = behavior === 'unspecified'
      ? await activeSubscriptionCount(key, price.id, cap) : 0;
    const [state, detail] = verdict(behavior, subs, codes.get(product), autoTax);

    const line = `${state.padEnd(12)} ${price.id}  ${detail}`;
    if (state === 'ready') { console.log(line); continue; }

    findings += 1;
    console.warn(line);
    if (state === 'dormant') {
      console.warn('  set tax_behavior on this price while it is still unspecified; ' +
        'the value is permanent once set');
    } else if (state === 'live' || state === 'blocking') {
      console.warn(`  create a replacement price on product ${product} with the same ` +
        'amount, currency and interval plus an explicit tax_behavior, migrate the ' +
        `subscriptions with an explicit proration decision, then archive ${price.id}`);
    } else {
      console.warn(`  set a tax_code on product ${product} so the rate stops falling ` +
        'back to the account default');
    }
  }

  console.log(`${total} active price(s), ${findings} needing attention`);
  if (findings) process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
