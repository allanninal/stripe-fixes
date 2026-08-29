"""Report webhook endpoints subscribed to charge events on a PaymentIntent integration.

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
log = logging.getLogger("stripe_charge_event_drift")

API = "https://api.stripe.com/v1"

CHARGE = "charge.succeeded"
INTENT = "payment_intent.succeeded"
SESSION = "checkout.session.completed"


def verdict(enabled_events, fired_types):
    """Classify one endpoint's fulfilment subscription. Pure and testable.

    `fired_types` is the set of modern success types actually seen in the
    retained window. Checked in order of how much fulfilment they cost you:
    a missing path first, then a duplicated one. Returns (state, detail).
    """
    events = set(enabled_events or [])
    fired = set(fired_types or [])
    modern = INTENT in events or SESSION in events

    if "*" in events:
        return ("wildcard",
                "a wildcard delivers both shapes of the same payment. Fulfilment "
                "has to pick one and ignore the other, explicitly.")

    if CHARGE in events and not modern:
        if fired & {INTENT, SESSION}:
            return ("stale",
                    "%s is the only success subscription, but %s fired in the "
                    "retained window. The Charge carries neither the intent "
                    "metadata nor client_reference_id."
                    % (CHARGE, ", ".join(sorted(fired & {INTENT, SESSION}))))
        return ("legacy",
                "%s only, and no PaymentIntent or Checkout events fired. This "
                "looks like a genuine Charges API integration rather than a "
                "stale subscription." % CHARGE)

    if SESSION in fired and SESSION not in events:
        return ("checkout-gap",
                "Checkout Sessions are completing and %s is not subscribed. No "
                "charge or payment_intent subscription implies it." % SESSION)

    if CHARGE in events and modern:
        return ("overlapping",
                "%s and the fulfilment event are both subscribed, so one payment "
                "arrives twice in two shapes. Fulfil on one and drop the other."
                % CHARGE)

    return ("aligned", "fulfilment events match the integration")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def modern_types_seen(session):
    """Which of the modern success types have fired in the retained window."""
    page = get(session, "/events", limit=100, **{"types[]": [INTENT, SESSION]})
    return {ev.get("type") for ev in page.get("data", [])}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--quiet-aligned", action="store_true",
                    help="print only the endpoints that need attention")
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

    fired = modern_types_seen(s)
    log.info("modern success types seen: %s", ", ".join(sorted(fired)) or "none")

    bad = 0
    for ep in endpoints:
        state, detail = verdict(ep.get("enabled_events"), fired)
        line = "%-12s %s  %s" % (state, ep.get("url", "?"), detail)
        if state in ("aligned", "legacy"):
            if not args.quiet_aligned:
                log.info(line)
            continue
        bad += 1
        log.warning(line)
        want = SESSION if SESSION in fired else INTENT
        log.warning("  repair: add enabled_events[]=%s to %s/webhook_endpoints/%s, "
                    "ship the handler branch, then remove %s",
                    want, API, ep["id"], CHARGE)

    log.info("%d endpoint(s), %d needing attention", len(endpoints), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
