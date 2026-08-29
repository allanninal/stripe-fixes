"""Report Stripe webhook endpoints that share a URL and deliver every event twice.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Webhook Endpoints and Events. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
from urllib.parse import urlsplit

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_duplicate_endpoints")

API = "https://api.stripe.com/v1"


def normalise(url):
    """Reduce a webhook URL to the destination it actually is. Pure.

    Stripe's own API-version upgrade procedure tells you to create the second
    endpoint with a query parameter, so the query string is exactly what makes a
    duplicate look distinct. Strip it, strip a trailing slash, lowercase the host.
    """
    parts = urlsplit((url or "").strip())
    host = (parts.hostname or "").lower()
    if parts.port:
        host = "%s:%d" % (host, parts.port)
    path = parts.path.rstrip("/")
    return "%s://%s%s" % ((parts.scheme or "").lower(), host, path)


def verdict(group):
    """Classify one group of endpoints sharing a normalised URL and mode. Pure.

    Returns (state, detail).
    """
    if not group:
        return ("unique", "no endpoints")
    enabled = [e for e in group if e.get("status") == "enabled"]
    if len(enabled) > 1:
        return ("duplicate",
                "%d enabled endpoints on one URL: every subscribed event is "
                "delivered %d times and both signatures verify."
                % (len(enabled), len(enabled)))
    if len(group) > 1:
        return ("residue",
                "%d endpoint(s) on this URL, %d enabled. The disabled ones are "
                "leftovers, not duplicates." % (len(group), len(enabled)))
    return ("unique", "%d enabled endpoint" % len(enabled))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def group_endpoints(endpoints):
    """Group by (livemode, normalised url). Pure, given the endpoint list."""
    groups = {}
    for ep in endpoints:
        key = (bool(ep.get("livemode")), normalise(ep.get("url")))
        groups.setdefault(key, []).append(ep)
    return groups


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corroborate", action="store_true",
                    help="also read recent events and report pending_webhooks")
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
    for (livemode, url), group in sorted(group_endpoints(endpoints).items()):
        state, detail = verdict(group)
        mode = "live" if livemode else "test"
        line = "%-10s %s %s  %s" % (state, mode, url, detail)
        if state == "unique":
            log.info(line)
            continue
        if state == "residue":
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        for ep in group:
            log.warning("    %s  %s  version=%s  %d event type(s)",
                        ep["id"], ep.get("status"),
                        ep.get("api_version") or "account default",
                        len(ep.get("enabled_events") or []))
        keep = group[0]["id"]
        for ep in group[1:]:
            log.warning("  repair: keep %s, then "
                        "POST %s/webhook_endpoints/%s -d disabled=true",
                        keep, API, ep["id"])
        log.warning("  then make the handler idempotent on event.id, which is "
                    "required regardless: Stripe delivers at least once.")

    if args.corroborate:
        recent = get(s, "/events", limit=20).get("data", [])
        pending = [e.get("pending_webhooks", 0) for e in recent]
        if pending:
            log.info("recent events: pending_webhooks max=%d (1 per subscribed "
                     "destination while in flight)", max(pending))

    log.info("%d endpoint(s), %d duplicated URL group(s)", len(endpoints), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
