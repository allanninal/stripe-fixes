/**
 * Report Stripe webhook endpoints Stripe cannot reach: tunnels, localhost, http.
 *
 * Read only. One GET, no writes: give this a RESTRICTED key with read access to
 * Webhook Endpoints. The repair is printed, never performed.
 */
const API = 'https://api.stripe.com/v1';

// Hostname suffixes handed out by development tunnels. Matched as suffixes, not
// substrings: https://localhost-tools.example.com is a real production host.
const TUNNELS = ['.ngrok.io', '.ngrok-free.app', '.ngrok.app', '.ngrok.dev',
  '.loca.lt', '.trycloudflare.com', '.serveo.net'];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function splitUrl(url) {
  try {
    const parsed = new URL(url ?? '');
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return ['', ''];
    return [parsed.protocol.replace(':', '').toLowerCase(), host];
  } catch {
    return ['', ''];
  }
}

/** True for loopback and RFC1918 literals, which Stripe can never reach. */
export function unroutableIp(host) {
  const octets = host.split('.');
  if (octets.length !== 4 || !octets.every((o) => /^\d+$/.test(o))) return false;
  const [a, b] = [Number(octets[0]), Number(octets[1])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

/**
 * Classify one endpoint URL. Pure, so the rules can be tested offline.
 * The mode is part of the input on purpose: a tunnel hostname is how local
 * development works and is only a fault in live mode.
 */
export function verdict(url, livemode) {
  const [scheme, host] = splitUrl(url);
  if (!host) return ['unparseable', `${JSON.stringify(url)} is not a URL with a scheme and a host`];

  let kind;
  if (LOOPBACK.has(host) || unroutableIp(host)) {
    kind = ['unroutable',
      `${host} is not reachable from outside your network, so no event has ever ` +
      'arrived and none will.'];
  } else if (TUNNELS.some((t) => host === t.slice(1) || host.endsWith(t))) {
    kind = ['tunnel',
      `${host} is a development tunnel host. It resolves only while the tunnel ` +
      'process is running and the name changes when it restarts.'];
  } else if (scheme !== 'https') {
    kind = ['plaintext',
      `the scheme is ${scheme}. Stripe delivers over HTTPS with TLS 1.2 or 1.3, ` +
      'and there is nothing to negotiate on a plaintext port.'];
  } else {
    return ['ok', 'public https host'];
  }

  if (!livemode) {
    return ['dev',
      `test mode: ${kind[1]} Expected while developing. The risk is this URL ` +
      'being copied into the live endpoint.'];
  }
  return kind;
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

async function main() {
  const key = (process.env.STRIPE_API_KEY || "dummy-stripe-api-key");
  if (!key) {
    console.error('set STRIPE_API_KEY (use a restricted, read-only key)');
    process.exitCode = 2;
    return;
  }

  const { data: endpoints = [] } = await get(key, '/webhook_endpoints', { limit: 100 });
  if (endpoints.length === 0) {
    console.log("no webhook endpoints configured for this key's mode");
    return;
  }

  const includeTest = process.argv.includes('--include-test-mode');
  let bad = 0;
  for (const ep of endpoints) {
    const [state, detail] = verdict(ep.url, Boolean(ep.livemode));
    const line = `${state.padEnd(11)} ${ep.url ?? '?'}  ${detail}`;
    if (state === 'ok') { console.log(line); continue; }
    if (state === 'dev') { if (includeTest) console.log(line); continue; }
    bad += 1;
    console.warn(line);
    console.warn(`  repair: update ${API}/webhook_endpoints/${ep.id} with ` +
                 'url=https://<your-domain>/stripe/webhook, which keeps the signing secret');
    console.warn('  or remove the endpoint if it is a development leftover, and use: ' +
                 'stripe listen --forward-to localhost:4242/webhook');
  }

  console.log(`${endpoints.length} endpoint(s), ${bad} unreachable`);
  process.exitCode = bad ? 1 : 0;
}

// Only run when invoked directly. The test file imports this module, and without
// the guard main() would run there too, fail on the missing key, and set a
// non-zero exit code that fails the whole test file even as every test passes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 2; });
}
