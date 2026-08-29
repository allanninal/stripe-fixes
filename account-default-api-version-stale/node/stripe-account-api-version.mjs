/**
 * Report the Stripe account's default API version and how far behind it is.
 *
 * Read only. One GET and no writes: give this a RESTRICTED key with read access
 * to Events. The upgrade is printed, never performed.
 *
 * Deliberately uses fetch rather than an SDK. Every official Stripe library
 * sends its own Stripe-Version header, and Stripe honours it, so an SDK-based
 * version of this script reads back the library's version, not the account's.
 */
const API = 'https://api.stripe.com/v1';

export const CURRENT_LINE = '2025-09-30'; // Clover
const DATE = /^(\d{4}-\d{2}-\d{2})/;
const YEAR = 365;

/**
 * Decide which of the two indirect readings to believe. Pure.
 * Returns [version, note].
 */
export function authority(eventVersion, headerVersion) {
  if (!eventVersion && !headerVersion) {
    return [null,
      'no reading available: no events in the 30 day window and no ' +
      'Stripe-Version on the response'];
  }
  if (headerVersion && !eventVersion) {
    return [headerVersion,
      'from the Stripe-Version response header; no events in the window to ' +
      'corroborate it'];
  }
  if (eventVersion && !headerVersion) {
    return [eventVersion,
      'from the newest event; the response carried no Stripe-Version header, ' +
      'so this is the default as of that event and not now'];
  }
  if (String(headerVersion).split('.')[0] !== String(eventVersion).split('.')[0]) {
    return [headerVersion,
      `the header says ${headerVersion} and the newest event says ` +
      `${eventVersion}: the default moved after that event, or was rolled back ` +
      'inside the 72 hour window. The retained events span both shapes.'];
  }
  return [headerVersion, 'header and newest event agree'];
}

/**
 * How far behind the account default is. Pure. `today` is an ISO date string
 * and is an argument so the tests keep the same answer as the calendar moves.
 */
export function verdict(version, today, currentLine = CURRENT_LINE) {
  if (!version) {
    return ['unknown',
      'nothing to judge: the account default could not be read from an event ' +
      'or from a response header'];
  }
  const m = DATE.exec(String(version));
  if (!m) {
    return ['unreadable', `${version} has no YYYY-MM-DD prefix to compare`];
  }
  const date = m[1];
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - YEAR * 86400000)
    .toISOString().slice(0, 10);
  if (date < cutoff) {
    return ['stale',
      `the account default is ${date}, more than a year behind. Read the ` +
      `changelog for every release line between ${date} and ${currentLine}; the ` +
      'breaking changes accumulate rather than replace each other.'];
  }
  if (date < currentLine) {
    return ['trailing',
      `the account default is ${date}, behind the current ${currentLine} line ` +
      'but within a year of it. One changelog to read.'];
  }
  return ['current', `the account default is ${date}, on the current line`];
}

export async function readDefault(key) {
  const url = new URL(API + '/events');
  url.searchParams.set('limit', '1');
  // No Stripe-Version header here on purpose: that is what makes the response
  // header report the account default rather than echo a version we chose.
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) {
    throw new Error('401 from Stripe: the key is wrong, or is for the other mode');
  }
  if (!res.ok) throw new Error(`${res.status} from ${url.pathname}`);
  const body = await res.json();
  const first = (body.data ?? [])[0];
  return [first ? first.api_version : null, res.headers.get('stripe-version')];
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const today = (process.env.TODAY || "dummy-today") ?? new Date().toISOString().slice(0, 10);
  const [eventVersion, headerVersion] = await readDefault(key);
  const [version, note] = authority(eventVersion, headerVersion);
  const [state, detail] = verdict(version, today);

  console.log(`  ${state.padEnd(9)} ${version ?? 'unknown'}`);
  console.log(`  ${note}`);

  if (state === 'current') {
    console.log(`${state}  ${detail}`);
    return;
  }

  console.warn(`${state}  ${detail}`);
  console.warn('  test first without changing anything: send a per-request ' +
               `Stripe-Version: ${CURRENT_LINE} header and run your integration ` +
               'against it');
  console.warn('  then upgrade in the Dashboard: Workbench, Overview, API ' +
               'versions, Upgrade available');
  console.warn('  you get a 72 hour rollback window, during which webhooks that ' +
               'fail on the new shape are retried with the old structure');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
