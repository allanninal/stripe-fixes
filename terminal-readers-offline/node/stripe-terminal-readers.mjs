/**
 * Report Stripe Terminal readers that are offline, stale, wedged or behind on firmware.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Terminal. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// last_seen_at is in MILLISECONDS, unlike almost every other Stripe timestamp.
// Anything below this is a seconds value passed in by mistake.
export const MS_FLOOR = 100000000000;

export const STALE_HOURS = 6.0;

/**
 * Classify one Terminal reader. Pure, so the units guard can be tested offline.
 * `lastSeenAtMs` and `nowMs` are both milliseconds.
 */
export function readerState(status, lastSeenAtMs, nowMs, actionStatus = null,
                            failureCode = null, staleHours = STALE_HOURS) {
  const missing = (v) => v === null || v === undefined;
  if (!missing(lastSeenAtMs) && lastSeenAtMs < MS_FLOOR) {
    return ['unknown',
      `last_seen_at is ${lastSeenAtMs}, which is a seconds timestamp; this reader ` +
      'cannot be judged until the units are right'];
  }
  const ageH = missing(lastSeenAtMs) ? null : (nowMs - lastSeenAtMs) / 3600000;
  if (status === 'offline') {
    const seen = ageH === null ? 'never seen' : `last seen ${ageH.toFixed(1)} hour(s) ago`;
    return ['offline', `status offline, ${seen}; it will not take a payment`];
  }
  if (ageH === null) {
    return ['unknown', 'no last_seen_at, so liveness cannot be confirmed'];
  }
  if (ageH >= staleHours) {
    return ['stale',
      `status ${status} but no check-in for ${ageH.toFixed(1)} hour(s); status lags ` +
      'reality, so treat this as unusable'];
  }
  if (actionStatus === 'failed') {
    return ['action_failed',
      `reachable but wedged on a failed action: ${failureCode || 'no failure_code on the action'}`];
  }
  if (status === 'online') return ['online', `checked in ${ageH.toFixed(1)} hour(s) ago`];
  return ['unknown', `unrecognised status ${JSON.stringify(status)}`];
}

/** Readers not on the version most of their own device_type is running. Pure. */
export function firmwareOutliers(readers) {
  const byType = new Map();
  for (const r of readers) {
    if (!byType.has(r.device_type)) byType.set(r.device_type, []);
    byType.get(r.device_type).push(r);
  }
  const out = [];
  for (const deviceType of [...byType.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
    const group = byType.get(deviceType);
    const counts = new Map();
    for (const r of group) {
      if (r.device_sw_version) {
        counts.set(r.device_sw_version, (counts.get(r.device_sw_version) ?? 0) + 1);
      }
    }
    if (group.length < 2 || counts.size === 0) continue;
    let majority = null;
    let best = -1;
    for (const [v, n] of counts) if (n > best) { majority = v; best = n; }
    for (const r of group) {
      if (r.device_sw_version && r.device_sw_version !== majority) {
        out.push([r.id, deviceType, r.device_sw_version, majority]);
      }
    }
  }
  return out;
}

async function get(key, path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (res.status === 403) {
    throw new Error('403 from Stripe: the restricted key has no read access to Terminal');
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  return res.json();
}

async function pageAll(key, path, params, cap = 2000) {
  const out = [];
  const p = { ...params };
  for (;;) {
    const page = await get(key, path, p);
    const data = page.data ?? [];
    out.push(...data);
    if (data.length === 0 || !page.has_more || out.length >= cap) return out;
    p.starting_after = data[data.length - 1].id;
  }
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }
  const staleHours = Number((process.env.STALE_HOURS || "dummy-stale-hours") ?? STALE_HOURS);
  const params = { limit: 100 };
  if ((process.env.LOCATION || "dummy-location")) params.location = (process.env.LOCATION || "dummy-location");
  const readers = await pageAll(key, '/terminal/readers', params);

  const nowMs = Date.now();
  let bad = 0;
  let freshest = null;
  for (const r of readers) {
    const action = r.action ?? {};
    const [state, detail] = readerState(r.status, r.last_seen_at, nowMs,
      action.status, action.failure_code, staleHours);
    if (r.last_seen_at && r.last_seen_at >= MS_FLOOR
        && (freshest === null || r.last_seen_at > freshest)) {
      freshest = r.last_seen_at;
    }
    if (state !== 'online') {
      bad += 1;
      console.warn(`  ${state.padEnd(13)} ${r.id}  ${r.label ?? r.device_type}  ${detail}`);
    }
  }

  const drift = firmwareOutliers(readers);
  for (const [rid, deviceType, version, majority] of drift) {
    console.warn(`  firmware      ${rid}  ${deviceType} on ${version}, the rest of ` +
                 `the fleet is on ${majority}`);
  }

  if (!bad && drift.length === 0) {
    const age = freshest === null ? 0 : (nowMs - freshest) / 3600000;
    console.log(`clear       ${readers.length} reader(s) online, newest check-in ` +
                `${age.toFixed(1)}h, firmware consistent`);
    return;
  }

  console.warn(`offline     ${bad} of ${readers.length} reader(s) not usable, ` +
               `${drift.length} on odd firmware`);
  console.warn('  power-cycle the reader and confirm the location network reaches ' +
               'Stripe, then re-check:');
  console.warn(`  GET ${API}/terminal/readers/<tmr_id>   ` +
               '(want status online AND a fresh last_seen_at)');
  console.warn('  leave drifting readers powered and connected through their ' +
               'configured update window');
  console.warn('  retire dead hardware so it stops filling this report:');
  console.warn(`  DELETE ${API}/terminal/readers/<tmr_id>`);
  process.exitCode = 1;
}

// Only run when invoked directly, so importing this module from the test file
// does not fire main() and fail the suite on the missing key.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
