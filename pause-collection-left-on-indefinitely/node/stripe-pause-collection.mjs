/**
 * Report subscriptions left with pause_collection and no resumes_at.
 *
 * Read only. One GET, no writes: give this a RESTRICTED key with read access to
 * Subscriptions. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';
const DAY = 86400;

// Behaviours that dispose of the invoice as it is created. keep_as_draft, the
// remaining one, leaves something you can still finalise.
const DISCARDING = new Set(['void', 'mark_uncollectible']);

/**
 * Classify one subscription's pause_collection. Pure, so it can be tested.
 * Never reads `status`: pause_collection leaves the status alone, which is
 * exactly why the field needs a check of its own.
 */
export function verdict(sub, now) {
  const pause = sub.pause_collection;
  if (!pause) return ['collecting', 'no pause on this subscription'];

  const behavior = pause.behavior ?? 'keep_as_draft';
  const resumes = pause.resumes_at ?? null;

  if (resumes === null) {
    if (DISCARDING.has(behavior)) {
      return ['unrecoverable',
        `paused with no resumes_at and behavior ${behavior}: every invoice for ` +
        'a paused period is disposed of as it is created'];
    }
    return ['indefinite',
      `paused with no resumes_at and behavior ${behavior}: invoices accumulate ` +
      'as drafts that nothing will finalise'];
  }

  if (resumes <= now) {
    return ['overdue',
      `resumes_at passed ${Math.floor((now - resumes) / DAY)} day(s) ago and ` +
      'collection is still paused'];
  }
  return ['scheduled',
    `resumes in ${Math.floor((resumes - now) / DAY)} day(s); this pause has an end`];
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

export async function activeSubscriptions(key, limit = 5000) {
  const out = [];
  const params = { status: 'active', limit: 100 };
  for (;;) {
    const page = await get(key, '/subscriptions', params);
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

  const subs = await activeSubscriptions(key);
  const now = Math.floor(Date.now() / 1000);
  const counts = new Map();
  for (const sub of subs) {
    const [state, detail] = verdict(sub, now);
    counts.set(state, (counts.get(state) ?? 0) + 1);
    if (state === 'collecting' || state === 'scheduled') continue;
    console.warn(`${state.padEnd(13)} ${sub.id}  ${detail}`);
    console.warn(`  repair: POST ${API}/subscriptions/${sub.id} -d pause_collection=`);
    if (state === 'indefinite') {
      console.warn(`  then per draft: POST ${API}/invoices/{inv} -d auto_advance=true`);
    }
  }

  const indefinite = (counts.get('indefinite') ?? 0) + (counts.get('unrecoverable') ?? 0);
  console.log(`${subs.length} active subscription(s), ${indefinite} paused ` +
              `indefinitely, ${counts.get('scheduled') ?? 0} scheduled to resume`);
  if (counts.get('overdue')) {
    console.log(`${counts.get('overdue')} still paused past their own resumes_at`);
  }
  process.exitCode = (indefinite || counts.get('overdue')) ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
