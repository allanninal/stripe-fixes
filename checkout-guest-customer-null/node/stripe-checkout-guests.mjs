/**
 * Report Stripe Checkout Sessions that completed without a Customer.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Checkout Sessions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one completed Checkout Session. Pure, so the rules can be tested
 * offline. `emailSeen` is how many sessions in the window share this session's
 * customer_details.email.
 */
export function verdict(session, emailSeen = 1) {
  if (session.customer) return ['linked', `customer=${session.customer}`];

  const mode = session.mode;
  if (mode !== 'payment') {
    return ['unknown',
      `mode ${JSON.stringify(mode)} completed with no Customer, which Stripe ` +
      'normally requires here'];
  }

  const creation = session.customer_creation;
  if (creation === 'always') {
    return ['unknown',
      'customer_creation=always but no Customer is attached; check the session ' +
      'really completed'];
  }

  const email = String(session.customer_details?.email ?? '').trim();
  if (!email) {
    return ['anonymous',
      'no Customer and no customer_details.email: nothing at all to match this ' +
      'payment to later'];
  }
  if (emailSeen > 1) {
    return ['repeat-guest',
      `${email} completed ${emailSeen} sessions in this window and was a new ` +
      'stranger every time'];
  }
  return ['guest',
    `customer_creation=${JSON.stringify(creation)}, so Stripe made no Customer; ` +
    `${email} exists only as a string on the Session`];
}

/** The address a guest session could later be matched on, normalised. */
export function emailOf(session) {
  return String(session.customer_details?.email ?? '').trim().toLowerCase();
}

/** Count how many sessions share each address. Pure. */
export function emailCounts(sessions) {
  const counts = new Map();
  for (const s of sessions) {
    const addr = emailOf(s);
    if (addr) counts.set(addr, (counts.get(addr) ?? 0) + 1);
  }
  return counts;
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

export async function* completedSessions(key, since, limit = 5000) {
  let seen = 0;
  const params = { limit: 100, status: 'complete', 'created[gte]': Math.floor(since) };
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

  const days = Number(process.argv[2] ?? 90);
  const sessions = [];
  for await (const s of completedSessions(key, Date.now() / 1000 - days * 86400)) {
    sessions.push(s);
  }
  if (sessions.length === 0) {
    console.log(`no completed Checkout Sessions in the last ${days} days`);
    return;
  }

  const counts = emailCounts(sessions);
  const tally = { linked: 0, guest: 0, 'repeat-guest': 0, anonymous: 0, unknown: 0 };
  const repeats = [];
  for (const s of sessions) {
    const [state, detail] = verdict(s, counts.get(emailOf(s)) ?? 1);
    tally[state] = (tally[state] ?? 0) + 1;
    if (state === 'repeat-guest' && repeats.length < 10) {
      repeats.push([s.id ?? '?', detail]);
    }
  }

  console.log(`${sessions.length} session(s): ${tally.linked} linked, ` +
              `${tally.guest} guest, ${tally['repeat-guest']} repeat-guest, ` +
              `${tally.anonymous} anonymous`);
  for (const [id, detail] of repeats) console.warn(`repeat-guest  ${id}  ${detail}`);
  if (tally.unknown) {
    console.warn(`${tally.unknown} session(s) in an unexpected state; read them by hand`);
  }

  if (tally.guest + tally['repeat-guest'] + tally.anonymous) {
    console.warn(`  repair: POST ${API}/checkout/sessions -d customer_creation=always`);
    console.warn('          or pass the id you already hold: -d customer=cus_XXX');
    console.warn('  for a Payment Link, set it on the link: POST ' +
                 `${API}/payment_links/plink_XXX -d customer_creation=always`);
    process.exitCode = 1;
  }
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
