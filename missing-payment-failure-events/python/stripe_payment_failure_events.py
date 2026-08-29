"""Report whether anything subscribes to Stripe payment and invoice failure events.

Read only. Three GETs, no writes: give this a RESTRICTED key with read access to
Webhook Endpoints, Subscriptions and Events. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_payment_failure_events")

API = "https://api.stripe.com/v1"

PI_OK = "payment_intent.succeeded"
PI_FAIL = "payment_intent.payment_failed"
INV_FAIL = "invoice.payment_failed"


def verdict(subscribed, has_active_subscriptions, failed_invoices):
    """Classify payment-failure coverage across both surfaces. Pure and testable.

    `subscribed` is the union of enabled_events across every endpoint. The
    billing surface only counts when the account actually has recurring billing,
    and failures already seen turn a gap into an incident. Returns (state, detail).
    """
    events = set(subscribed or [])
    if "*" in events:
        return ("wildcard",
                "a wildcard covers both failure events, and every other type "
                "along with them.")

    one_off_gap = PI_OK in events and PI_FAIL not in events
    billing_gap = bool(has_active_subscriptions) and INV_FAIL not in events

    if billing_gap and failed_invoices:
        return ("blind",
                "%d invoice payment(s) already failed and %s is not subscribed. "
                "Dunning is running right now and nothing is being told."
                % (failed_invoices, INV_FAIL))
    if one_off_gap and billing_gap:
        return ("exposed",
                "neither %s nor %s is subscribed. Both the one-off and the "
                "billing failure paths are silent." % (PI_FAIL, INV_FAIL))
    if one_off_gap:
        return ("one-sided",
                "%s is subscribed and %s is not: the success path is wired and "
                "declines go nowhere." % (PI_OK, PI_FAIL))
    if billing_gap:
        return ("billing-gap",
                "the account has active subscriptions and %s is not subscribed. "
                "Renewal declines and exhausted retries are invisible." % INV_FAIL)
    if PI_FAIL in events or INV_FAIL in events:
        return ("covered", "both applicable failure events are subscribed")
    return ("no-payment-events",
            "nothing subscribes to payment success or failure at all. The gap "
            "here is the endpoint configuration rather than one event type.")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def subscribed_union(session):
    """Every event type any endpoint on this account asks for."""
    union = set()
    for ep in get(session, "/webhook_endpoints", limit=100).get("data", []):
        union.update(ep.get("enabled_events") or [])
    return union


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=100,
                    help="how many failure events to count when sizing the gap")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    union = subscribed_union(s)
    active = get(s, "/subscriptions", limit=1, status="active").get("data", [])
    failures = get(s, "/events", limit=args.max_events,
                   **{"types[]": [INV_FAIL]}).get("data", [])

    state, detail = verdict(union, bool(active), len(failures))
    line = "%-17s %s" % (state, detail)
    if state in ("covered", "wildcard"):
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  repair: add enabled_events[]=%s and enabled_events[]=%s to an "
                "existing endpoint at %s/webhook_endpoints/{id}", PI_FAIL, INV_FAIL, API)
    log.warning("  add invoice.payment_action_required as well if renewals use 3D Secure")
    return 1


if __name__ == "__main__":
    sys.exit(main())
