/**
 * Report a Stripe Billing Portal configuration with cancellation switched off.
 *
 * Read only. Two GETs and no writes: give this a RESTRICTED key with read access
 * to the Customer Portal and Disputes. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

/**
 * Classify one portal configuration. Pure, so it is testable offline.
 * A missing enabled flag is unknown, not false.
 */
export function verdict(configuration, cancelDisputes = 0, totalDisputes = 0) {
  const features = (configuration ?? {}).features ?? {};
  const cancel = features.subscription_cancel ?? {};
  const update = features.payment_method_update ?? {};
  const id = (configuration ?? {}).id ?? '<no id>';

  const enabled = cancel.enabled;
  if (enabled === null || enabled === undefined) {
    return ['unknown',
      `${id} does not report features.subscription_cancel.enabled; read the ` +
      'configuration rather than assuming either way'];
  }
  if (!enabled) {
    if (cancelDisputes) {
      const share = totalDisputes ? (100 * cancelDisputes / totalDisputes) : 0;
      return ['cancel-off-disputed',
        `${id} has no cancel button, and ${cancelDisputes} of ${totalDisputes} ` +
        `dispute(s) in the window (${share.toFixed(1)}%) are subscription_canceled`];
    }
    return ['cancel-off',
      `${id} has no cancel button: the fastest exit a customer has is their bank`];
  }
  if (!update.enabled) {
    return ['update-off',
      `${id} can cancel but cannot update a card, so an expired card still goes ` +
      'to support'];
  }
  if (!(cancel.cancellation_reason ?? {}).enabled) {
    return ['no-reason',
      `${id} cancels at ${cancel.mode ?? 'an unspecified point'} and collects no ` +
      'cancellation reason: the churn data is free and is being discarded'];
  }
  return ['self-serve', `${id}: cancel ${cancel.mode ?? 'on'}, card update on`];
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

export async function configurations(key) {
  const out = [];
  const params = { limit: 100 };
  for (;;) {
    const page = await get(key, '/billing_portal/configurations', params);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more) break;
    params.starting_after = data[data.length - 1].id;
  }
  return out;
}

export async function disputeCounts(key, since, cap = 2000) {
  let cancel = 0; let total = 0;
  const params = { 'created[gte]': since, limit: 100 };
  for (;;) {
    const page = await get(key, '/disputes', params);
    const data = page.data ?? [];
    for (const d of data) {
      total += 1;
      if (d.reason === 'subscription_canceled') cancel += 1;
    }
    if (data.length === 0 || !page.has_more || total >= cap) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { cancel, total };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const configs = await configurations(key);
  if (configs.length === 0) {
    console.warn('no portal configuration exists at all, which is a louder ' +
                 'failure: every portal session create returns 400');
    process.exitCode = 1;
    return;
  }

  const days = Number(process.argv[2] ?? 180);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const { cancel, total } = await disputeCounts(key, since);

  let bad = 0;
  for (const config of configs) {
    if (!config.active) continue;
    const [state, detail] = verdict(config, cancel, total);
    const line = `${state.padEnd(20)} ${detail}`;
    if (state === 'self-serve') { console.log(line); continue; }
    bad += 1;
    console.warn(line);
    if (state === 'cancel-off' || state === 'cancel-off-disputed' || state === 'unknown') {
      console.warn(`  repair: POST ${API}/billing_portal/configurations/${config.id} ` +
                   '-d "features[subscription_cancel][enabled]=true" ' +
                   '-d "features[subscription_cancel][mode]=at_period_end" ' +
                   '-d "features[subscription_cancel][cancellation_reason][enabled]=true"');
    }
    if (state === 'update-off' || state === 'cancel-off' || state === 'cancel-off-disputed') {
      console.warn(`  and: POST ${API}/billing_portal/configurations/${config.id} ` +
                   '-d "features[payment_method_update][enabled]=true"');
    }
  }

  console.log(`${configs.length} active configuration(s), ${bad} needing attention`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
