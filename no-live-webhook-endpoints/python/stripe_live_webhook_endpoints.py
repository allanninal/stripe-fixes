"""Report whether this mode has a webhook endpoint at all, and whether it needs one.

Read only. Two GETs, no writes: give this a RESTRICTED key with read access to
Webhook Endpoints and Events. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_live_webhook_endpoints")

API = "https://api.stripe.com/v1"

# Events that prove this mode is carrying real business traffic. If any of these
# fired and no endpoint exists, work that should follow a payment never happened.
TRAFFIC_TYPES = ("payment_intent.succeeded", "checkout.session.completed",
                 "invoice.paid")


def verdict(endpoints, payment_events, livemode):
    """Classify webhook coverage for one mode. Pure, so the rules can be tested.

    `endpoints` is the raw data array from /v1/webhook_endpoints, `payment_events`
    the count of business events seen in the retained window, and `livemode`
    whether this key reads live data. Returns (state, detail).
    """
    eps = list(endpoints or [])
    enabled = [e for e in eps if e.get("status") == "enabled"]
    if not eps:
        if payment_events:
            return ("blind",
                    "%d payment event(s) in the retained window and no webhook "
                    "endpoint to receive them. Stripe had nowhere to push, so "
                    "nothing that should follow a payment ever ran."
                    % payment_events)
        return ("empty",
                "no webhook endpoint, and no payment events in the retained "
                "window either. Nothing has been lost yet: create the endpoint "
                "before the first real payment rather than after it.")
    if not enabled:
        return ("all-disabled",
                "%d endpoint(s) exist and every one of them is disabled, which "
                "delivers exactly as much as having none." % len(eps))
    if not livemode:
        return ("test-mode",
                "%d enabled endpoint(s), all test mode. A healthy test mode is "
                "what lets this ship: re-run with a live restricted key before "
                "concluding anything about production." % len(enabled))
    return ("covered", "%d enabled endpoint(s) in this mode" % len(enabled))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def is_livemode(key):
    """Mode from the key prefix. Confirmed against object livemode where possible."""
    return not key.startswith(("sk_test_", "rk_test_", "pk_test_"))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=100,
                    help="how many recent payment events to count as evidence")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    endpoints = get(s, "/webhook_endpoints", limit=100).get("data", [])
    events = get(s, "/events", limit=min(args.max_events, 100),
                 **{"types[]": list(TRAFFIC_TYPES)}).get("data", [])

    # Prefer the objects over the key prefix: a restricted key can be named
    # anything, but livemode on a returned object is the account's own answer.
    livemode = is_livemode(key)
    for obj in list(endpoints) + list(events):
        if "livemode" in obj:
            livemode = bool(obj["livemode"])
            break

    state, detail = verdict(endpoints, len(events), livemode)
    line = "%-12s %s" % (state, detail)
    if state == "covered":
        log.info(line)
        for ep in endpoints:
            log.info("  %s  %d subscribed type(s)",
                     ep.get("url", "?"), len(ep.get("enabled_events") or []))
        return 0

    log.warning(line)
    if state in ("blind", "empty"):
        log.warning("  repair: POST %s/webhook_endpoints", API)
        log.warning("    -d url=https://<your-domain>/stripe/webhook")
        log.warning("    -d enabled_events[]=payment_intent.succeeded")
        log.warning("    -d enabled_events[]=payment_intent.payment_failed")
        log.warning("  then copy the secret from the response into the server "
                    "environment: the whsec_ printed by the CLI is not it")
    if state == "blind":
        log.warning("  backfill: GET %s/charges?created[gte]=<unix> and "
                    "%s/invoices?created[gte]=<unix>, which are not retention "
                    "limited the way /v1/events is", API, API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
