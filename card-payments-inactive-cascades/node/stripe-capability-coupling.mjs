/**
 * Report connected accounts where the card_payments/transfers pair is down.
 *
 * Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
 * access to Connected accounts. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

const PAIR = ['card_payments', 'transfers'];

/**
 * Classify the coupled pair on one account. Pure and offline testable.
 * Stripe couples card_payments and transfers: where an account has both, either
 * one sitting at inactive disables the pair.
 */
export function verdict(capabilities) {
  const caps = capabilities ?? {};
  const present = PAIR.filter((name) => name in caps);
  if (present.length < PAIR.length) {
    return ['uncoupled',
      `only ${present.join(', ') || 'neither capability'} on this account, so the ` +
      'pair cannot disable itself'];
  }

  const inactive = PAIR.filter((name) => caps[name] === 'inactive');
  if (inactive.length === PAIR.length) {
    return ['coupled-down',
      'both card_payments and transfers are inactive; collect the union of their ' +
      'requirements, not one list at a time'];
  }
  if (inactive.length) {
    const blocked = PAIR.filter((name) => !inactive.includes(name));
    return ['coupled-down',
      `${inactive[0]} is inactive, which disables ${blocked[0]} as well; the field ` +
      `you need may be filed under ${inactive[0]}`];
  }

  const pending = PAIR.filter((name) => caps[name] === 'pending');
  if (pending.length) {
    return ['coupled-pending',
      `${pending.join(', ')} is pending verification; nothing to collect until ` +
      'Stripe finishes with what it already has'];
  }

  const other = PAIR.filter((name) => caps[name] !== 'active');
  if (other.length) {
    return ['unknown', `unrecognised status for ${other.map(
      (name) => `${name}=${JSON.stringify(caps[name])}`).join(', ')}`];
  }
  return ['healthy', 'both capabilities active'];
}

/**
 * Union currently_due across every capability, keeping who asked for each.
 * Returns [[field, [capability, ...]], ...] sorted by field.
 */
export function unionDue(capabilityObjects) {
  const owed = new Map();
  for (const cap of capabilityObjects ?? []) {
    const name = cap.id ?? '?';
    const req = cap.requirements ?? {};
    for (const field of [...(req.past_due ?? []), ...(req.currently_due ?? [])]) {
      if (!owed.has(field)) owed.set(field, new Set());
      owed.get(field).add(name);
    }
  }
  return [...owed.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([field, owners]) => [field, [...owners].sort()]);
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

async function* paginate(key, path, limit) {
  let seen = 0;
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, path, params);
    const data = page.data ?? [];
    for (const obj of data) {
      yield obj;
      if (++seen >= limit) return;
    }
    if (!page.has_more || data.length === 0) return;
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

  let total = 0, healthy = 0, down = 0, pending = 0, fields = 0;
  for await (const acct of paginate(key, '/accounts', 500)) {
    total += 1;
    const [state, detail] = verdict(acct.capabilities);
    if (state === 'healthy') { healthy += 1; continue; }
    if (state === 'uncoupled') continue;
    if (state === 'coupled-pending') {
      pending += 1;
      console.log(`${state.padEnd(16)} ${acct.id}  ${detail}`);
      continue;
    }
    down += 1;
    console.warn(`${state.padEnd(16)} ${acct.id}  ${detail}`);

    const { data: caps = [] } = await get(key, `/accounts/${acct.id}/capabilities`);
    const outstanding = unionDue(caps);
    fields += outstanding.length;
    for (const [field, owners] of outstanding) {
      console.warn(`    ${field.padEnd(42)} required by ${owners.join(', ')}`);
    }
    if (outstanding.length) {
      console.warn(`  repair: one POST ${API}/accounts/${acct.id} carrying every ` +
                   'field above');
    } else {
      console.warn('  no fields outstanding: check requirements.disabled_reason and ' +
                   'requirements.errors on each capability');
    }
  }

  console.log(`${total} account(s): ${healthy} healthy, ${down} coupled down, ` +
              `${pending} pending, ${fields} field(s) outstanding`);
  process.exitCode = down ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
