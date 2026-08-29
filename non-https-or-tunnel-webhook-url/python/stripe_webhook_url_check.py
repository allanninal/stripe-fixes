"""Report Stripe webhook endpoints Stripe cannot reach: tunnels, localhost, http.

Read only. One GET, no writes: give this a RESTRICTED key with read access to
Webhook Endpoints. The repair is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
from urllib.parse import urlparse

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_webhook_url_check")

API = "https://api.stripe.com/v1"

# Hostname suffixes handed out by development tunnels. Matched as suffixes, not
# substrings: https://localhost-tools.example.com is a real production host.
TUNNELS = (".ngrok.io", ".ngrok-free.app", ".ngrok.app", ".ngrok.dev",
           ".loca.lt", ".trycloudflare.com", ".serveo.net")

LOOPBACK = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"}


def split_url(url):
    """(scheme, host) lowercased, or ('', '') when the URL is not usable."""
    try:
        parts = urlparse(url or "")
    except ValueError:
        return ("", "")
    if not parts.scheme or not parts.hostname:
        return ("", "")
    return (parts.scheme.lower(), parts.hostname.lower())


def unroutable_ip(host):
    """True for loopback and RFC1918 literals, which Stripe can never reach."""
    octets = host.split(".")
    if len(octets) != 4 or not all(o.isdigit() for o in octets):
        return False
    a, b = int(octets[0]), int(octets[1])
    return a == 10 or a == 127 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)


def verdict(url, livemode):
    """Classify one endpoint URL. Pure, so the rules can be tested offline.

    Returns (state, detail). The mode is part of the input on purpose: a tunnel
    hostname is how local development works and is only a fault in live mode.
    """
    scheme, host = split_url(url)
    if not host:
        return ("unparseable", "%r is not a URL with a scheme and a host" % (url,))

    if host in LOOPBACK or unroutable_ip(host):
        kind = ("unroutable",
                "%s is not reachable from outside your network, so no event has "
                "ever arrived and none will." % host)
    elif any(host == t.lstrip(".") or host.endswith(t) for t in TUNNELS):
        kind = ("tunnel",
                "%s is a development tunnel host. It resolves only while the "
                "tunnel process is running and the name changes when it restarts."
                % host)
    elif scheme != "https":
        kind = ("plaintext",
                "the scheme is %s. Stripe delivers over HTTPS with TLS 1.2 or "
                "1.3, and there is nothing to negotiate on a plaintext port."
                % scheme)
    else:
        return ("ok", "public https host")

    if not livemode:
        return ("dev",
                "test mode: %s Expected while developing. The risk is this URL "
                "being copied into the live endpoint." % kind[1])
    return kind


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--include-test-mode", action="store_true",
                    help="report test-mode endpoints too, as information")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    endpoints = get(s, "/webhook_endpoints", limit=100).get("data", [])
    if not endpoints:
        log.info("no webhook endpoints configured for this key's mode")
        return 0

    bad = 0
    for ep in endpoints:
        state, detail = verdict(ep.get("url"), bool(ep.get("livemode")))
        line = "%-11s %s  %s" % (state, ep.get("url", "?"), detail)
        if state == "ok":
            log.info(line)
            continue
        if state == "dev":
            if args.include_test_mode:
                log.info(line)
            continue
        bad += 1
        log.warning(line)
        log.warning("  repair: update %s/webhook_endpoints/%s with "
                    "url=https://<your-domain>/stripe/webhook, which keeps the "
                    "signing secret", API, ep["id"])
        log.warning("  or remove the endpoint if it is a development leftover, "
                    "and use: stripe listen --forward-to localhost:4242/webhook")

    log.info("%d endpoint(s), %d unreachable", len(endpoints), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
