/**
 * Report Stripe Payment Links whose completed payments fulfil nothing.
 *
 * Read only. Two GETs and no writes: give this a RESTRICTED key with read access
 * to Payment Links and Webhook Endpoints. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

export const COMPLETED_EVENT = 'checkout.session.completed';
export const PLACEHOLDER = '{CHECKOUT_SESSION_ID}';

/**
 * True when some enabled endpoint would receive checkout.session.completed.
 * Pure. A disabled endpoint receives nothing, and a wildcard subscription does
 * receive this event even though it receives a great deal else besides.
 */
export function listensForCompletion(endpoints) {
  for (const ep of endpoints ?? []) {
    if (ep.status !== 'enabled') continue;
    const events = ep.enabled_events ?? [];
    if (events.includes(COMPLETED_EVENT) || events.includes('*')) return true;
  }
  return false;
}

/**
 * Classify one Payment Link. Pure, so the rules can be tested offline.
 * `webhookCovered` is the account-wide fact from listensForCompletion().
 */
export function verdict(link, webhookCovered) {
  const after = link.after_completion ?? {};
  const kind = after.type ?? 'hosted_confirmation';

  if (kind === 'redirect') {
    const url = String(after.redirect?.url ?? '');
    if (!url.includes(PLACEHOLDER)) {
      return ['blind-redirect',
        `redirects to ${url || 'an empty url'} with no ${PLACEHOLDER}, so the ` +
        'landing page cannot tell which purchase it is confirming'];
    }
    if (!webhookCovered) {
      return ['landing-only',
        'the redirect is the only fulfilment trigger, and it fires only if the ' +
        "customer's browser reaches your page"];
    }
    return ['covered', 'redirects with the session id, and the event is subscribed'];
  }

  if (kind === 'hosted_confirmation') {
    if (webhookCovered) {
      return ['webhook-only',
        `the flow ends on Stripe's page, so fulfilment runs from ` +
        `${COMPLETED_EVENT} alone; the buyer never lands anywhere of yours`];
    }
    return ['unfulfilled',
      `the flow ends on Stripe's page and no enabled endpoint listens for ` +
      `${COMPLETED_EVENT}: nothing fulfils these payments at all`];
  }

  return ['unknown', `unrecognised after_completion.type ${JSON.stringify(kind)}`];
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

export async function* allPages(key, path, limit = 1000) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, path, params);
    const data = page.data ?? [];
    for (const obj of data) { yield obj; seen += 1; }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
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

  const { data: endpoints = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  const covered = listensForCompletion(endpoints);
  if (!covered) {
    console.warn(`no enabled webhook endpoint listens for ${COMPLETED_EVENT} ` +
                 "in this key's mode");
  }

  const tally = { covered: 0, 'webhook-only': 0, 'landing-only': 0,
    'blind-redirect': 0, unfulfilled: 0, unknown: 0 };
  const examples = [];
  let links = 0;

  for await (const link of allPages(key, '/payment_links')) {
    links += 1;
    const [state, detail] = verdict(link, covered);
    tally[state] = (tally[state] ?? 0) + 1;
    if (['unfulfilled', 'landing-only', 'blind-redirect'].includes(state)
        && examples.length < 20) {
      examples.push([state, link.id ?? '?', detail]);
    }
  }

  console.log(`${links} link(s): ${tally.covered} covered, ` +
              `${tally['webhook-only']} webhook-only, ${tally['landing-only']} ` +
              `landing-only, ${tally['blind-redirect']} blind-redirect, ` +
              `${tally.unfulfilled} unfulfilled`);
  for (const [state, id, detail] of examples) {
    console.warn(`${state.padEnd(14)} ${id}  ${detail}`);
  }

  if (tally.unfulfilled || tally['blind-redirect']) {
    console.warn(`  repair: POST ${API}/payment_links/plink_XXX ` +
                 `-d 'after_completion[type]=redirect' ` +
                 `-d 'after_completion[redirect][url]=` +
                 `https://example.com/after-checkout?session_id=${PLACEHOLDER}'`);
  }
  if (!covered) {
    console.warn(`  and subscribe an enabled endpoint to ${COMPLETED_EVENT} plus ` +
                 'checkout.session.async_payment_succeeded');
    console.warn('  check which links are actually in use: GET ' +
                 `${API}/checkout/sessions?payment_link=plink_XXX`);
  }

  process.exitCode =
    (tally.unfulfilled || tally['landing-only'] || tally['blind-redirect']) ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
