"""Report Stripe webhook endpoints that are disabled or losing events.

Read only. Two GET requests, no writes: give this a RESTRICTED key with read
access to Webhook Endpoints and Events. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_webhook_health")

API = "https://api.stripe.com/v1"


def verdict(endpoint, undelivered):
    """Classify one endpoint. Pure, so the rules can be tested without a network.

    Returns (state, detail). `undelivered` is the count of failed deliveries seen
    for this endpoint in the retained window.
    """
    status = endpoint.get("status")
    if status == "disabled":
        return ("disabled",
                "Stripe stopped delivering after repeated failures. "
                "Re-enable only after the handler answers 2xx.")
    if status != "enabled":
        return ("unknown", "unrecognised status %r" % (status,))
    if undelivered:
        return ("failing",
                "%d event(s) did not deliver. The endpoint is still enabled, so "
                "you have time before Stripe disables it." % undelivered)
    return ("healthy", "delivering normally")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def undelivered_by_endpoint(session, limit):
    """Count failed deliveries per endpoint id.

    Stripe returns the destinations an event failed to reach, so the count is
    attributed rather than guessed. Events are retained for 30 days; anything
    older than that cannot be replayed and is not counted here.
    """
    counts = {}
    total = 0
    params = {"delivery_success": "false", "limit": 100}
    while True:
        page = get(session, "/events", **params)
        for ev in page.get("data", []):
            total += 1
            for dest in ev.get("pending_webhooks_destinations", []) or []:
                counts[dest] = counts.get(dest, 0) + 1
        if not page.get("has_more") or total >= limit:
            break
        params["starting_after"] = page["data"][-1]["id"]
    return counts, total


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=1000,
                    help="stop counting undelivered events after this many")
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

    per_endpoint, total_undelivered = undelivered_by_endpoint(s, args.max_events)

    bad = 0
    for ep in endpoints:
        state, detail = verdict(ep, per_endpoint.get(ep["id"], 0))
        line = "%-9s %s  %s" % (state, ep.get("url", "?"), detail)
        if state == "healthy":
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        if state == "disabled":
            log.warning("  repair: POST %s/webhook_endpoints/%s -d disabled=false",
                        API, ep["id"])
            log.warning("  then replay: GET %s/events?delivery_success=false", API)

    log.info("%d endpoint(s), %d needing attention, %d undelivered event(s)",
             len(endpoints), bad, total_undelivered)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
