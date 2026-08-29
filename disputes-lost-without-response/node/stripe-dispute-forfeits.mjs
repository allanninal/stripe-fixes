/**
 * Measure how many lost Stripe disputes were forfeited rather than decided.
 *
 * Read only. One paginated GET and no writes: give this a RESTRICTED key with
 * read access to Disputes. The repair is a process change, printed for a human.
 */
const API = 'https://api.stripe.com/v1';

// Above this share of losses, the dispute process is not merely leaky.
export const FORFEIT_ALARM = 0.30;

/**
 * Classify a window of closed disputes. Pure, so both ratios can be tested.
 * `forfeited` is the subset of `lost` that closed with submission_count 0.
 */
export function verdict(lost, forfeited, won) {
  if (lost + won === 0) {
    return ['no_disputes', 'no dispute closed as won or lost in this window'];
  }
  if (forfeited > lost) {
    return ['unknown',
      `${forfeited} forfeit(s) against ${lost} loss(es); the counts disagree`];
  }
  if (lost === 0) return ['clean', `${won} dispute(s) closed, none lost`];

  const contestedLost = lost - forfeited;
  const denom = contestedLost + won;
  const rate = denom
    ? `the ${denom} contested dispute(s) lost ` +
      `${(100 * contestedLost / denom).toFixed(0)}% of the time`
    : 'nothing was contested, so there is no real loss rate to quote';

  if (forfeited === 0) {
    return ['contested', `${lost} loss(es), every one answered; ${rate}`];
  }

  const share = (100 * forfeited / lost).toFixed(0);
  const body = `${forfeited} of ${lost} loss(es) (${share}%) closed with ` +
               `submission_count 0; ${rate}`;
  if (forfeited / lost >= FORFEIT_ALARM) {
    return ['absent', body +
      '. At this share there is no dispute workflow, only a dispute list.'];
  }
  return ['leaking', body + '. Each of those was recoverable process loss.'];
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

export async function tally(key, since, limit = 5000) {
  let lost = 0, forfeited = 0, won = 0, seen = 0;
  const params = { limit: 100, 'created[gte]': Math.floor(since) };
  for (;;) {
    const page = await get(key, '/disputes', params);
    const data = page.data ?? [];
    for (const d of data) {
      seen += 1;
      if (d.status === 'won') won += 1;
      else if (d.status === 'lost') {
        lost += 1;
        if (!((d.evidence_details ?? {}).submission_count ?? 0)) forfeited += 1;
      }
    }
    if (data.length === 0 || !page.has_more || seen >= limit) break;
    params.starting_after = data[data.length - 1].id;
  }
  return { lost, forfeited, won };
}

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const days = Number(process.argv[2] ?? 365);
  const since = Date.now() / 1000 - days * 86400;
  const { lost, forfeited, won } = await tally(key, since);
  const [state, detail] = verdict(lost, forfeited, won);

  const line = `${state.padEnd(12)} ${detail}`;
  if (state === 'no_disputes' || state === 'clean' || state === 'contested') {
    console.log(line);
    return;
  }

  console.warn(line);
  console.warn('  repair: sweep evidence_details.due_by daily and route each ' +
               'dispute to a named human before it is 72 hours out');
  console.warn('  and pass customer IP, email, shipping address and product ' +
               'description on every payment, so a response is a review ' +
               'rather than a research project');
  process.exitCode = 1;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
