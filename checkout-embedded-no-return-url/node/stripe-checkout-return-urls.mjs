/**
 * Report Stripe Checkout Sessions whose return leg has no destination.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Checkout Sessions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Methods that take the customer off your page to authenticate.
// redirect_on_completion of "never" disables these outright.
export const REDIRECT_METHODS =
  ['ideal', 'bancontact', 'p24', 'sofort', 'eps', 'giropay', 'blik'];

// Stripe has spelled the ui_mode values differently across API versions, so
// accept both rather than reporting a pinned older version as unknown.
const EMBEDDED_MODES = ['embedded_page', 'embedded', 'elements'];
const HOSTED_MODES = ['hosted_page', 'hosted'];

export const PLACEHOLDER = '{CHECKOUT_SESSION_ID}';

/** Classify one Checkout Session. Pure, so the rules can be tested offline. */
export function verdict(session) {
  const ui = session.ui_mode ?? HOSTED_MODES[0];
  const methods = (session.payment_method_types ?? [])
    .filter((m) => REDIRECT_METHODS.includes(m));

  if (EMBEDDED_MODES.includes(ui)) {
    if (session.redirect_on_completion === 'never' && methods.length) {
      return ['blocked',
        'redirect_on_completion=never disables redirect-based methods, so ' +
        `${methods.join(', ')} are configured but never offered`];
    }
    if (!String(session.return_url ?? '').trim()) {
      return ['stranded',
        `ui_mode=${ui} with no return_url: a customer who authenticates ` +
        'off-site comes back to nowhere'];
    }
    return ['ok', `ui_mode=${ui} with a return_url`];
  }

  if (HOSTED_MODES.includes(ui)) {
    const success = String(session.success_url ?? '');
    if (!success.includes(PLACEHOLDER)) {
      return ['unjoinable',
        `success_url is ${success || 'empty'}: no ${PLACEHOLDER} placeholder, ` +
        'so the landing page cannot tell which session it is confirming'];
    }
    return ['ok', 'hosted, and success_url carries the session id'];
  }

  return ['unknown', `unrecognised ui_mode ${JSON.stringify(ui)}`];
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

export async function* sessions(key, since, limit = 5000) {
  let seen = 0;
  const params = { limit: 100, 'created[gte]': Math.floor(since) };
  for (;;) {
    const page = await get(key, '/checkout/sessions', params);
    const data = page.data ?? [];
    for (const s of data) { yield s; seen += 1; }
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

  const days = Number(process.argv[2] ?? 30);
  const tally = { ok: 0, stranded: 0, blocked: 0, unjoinable: 0, unknown: 0 };
  const examples = [];
  let total = 0;

  for await (const s of sessions(key, Date.now() / 1000 - days * 86400)) {
    total += 1;
    const [state, detail] = verdict(s);
    tally[state] = (tally[state] ?? 0) + 1;
    if (state !== 'ok' && examples.length < 10) {
      examples.push([state, s.id ?? '?', detail]);
    }
  }

  console.log(`${total} session(s): ${tally.ok} ok, ${tally.stranded} stranded, ` +
              `${tally.blocked} blocked, ${tally.unjoinable} unjoinable`);
  for (const [state, id, detail] of examples) {
    console.warn(`${state.padEnd(10)} ${id}  ${detail}`);
  }

  if (tally.stranded || tally.blocked) {
    console.warn(`  repair: POST ${API}/checkout/sessions -d ui_mode=embedded_page ` +
                 `-d return_url='https://example.com/after-checkout` +
                 `?session_id=${PLACEHOLDER}' -d redirect_on_completion=if_required`);
  }
  if (tally.unjoinable) {
    console.warn(`  repair: POST ${API}/checkout/sessions ` +
                 `-d success_url='https://example.com/thanks?session_id=${PLACEHOLDER}'`);
  }

  process.exitCode = total - tally.ok ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
