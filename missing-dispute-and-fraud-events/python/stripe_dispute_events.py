"""Report whether dispute and early fraud warning events are subscribed anywhere.

Read only. Three GETs, no writes: give this a RESTRICTED key with read access to
Webhook Endpoints, Disputes and Radar. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_dispute_events")

API = "https://api.stripe.com/v1"

DISPUTE = "charge.dispute.created"
DISPUTE_CLOSED = "charge.dispute.closed"
FRAUD = "radar.early_fraud_warning.created"


def verdict(subscribed, disputes, warnings):
    """Classify dispute and fraud coverage. Pure, so the rules can be tested.

    `subscribed` is the union of enabled_events across every endpoint, `disputes`
    and `warnings` the counts already on the account. The two signals stay
    separate because they fail at different times. Returns (state, detail).
    """
    events = set(subscribed or [])
    if "*" in events:
        return ("wildcard",
                "a wildcard subscription covers both signals, but it also "
                "delivers every other event type to the same handler.")
    if DISPUTE not in events:
        if disputes:
            return ("blind",
                    "%d dispute(s) on this account and nothing subscribes to %s. "
                    "Every response deadline so far was found by email."
                    % (disputes, DISPUTE))
        return ("unsubscribed",
                "nothing subscribes to %s. No disputes yet, so this is a gap "
                "rather than a deadline already running." % DISPUTE)
    if FRAUD not in events:
        if warnings:
            return ("fraud-blind",
                    "%d early fraud warning(s) already raised and nothing "
                    "subscribes to %s. A refund during that window prevents the "
                    "chargeback outright." % (warnings, FRAUD))
        return ("dispute-only",
                "%s is subscribed but %s is not. You will hear about chargebacks "
                "after they are filed and never before." % (DISPUTE, FRAUD))
    if DISPUTE_CLOSED not in events:
        return ("partial",
                "both opening signals are subscribed but %s is not, so nothing "
                "tells you how a dispute ended." % DISPUTE_CLOSED)
    return ("covered", "%s and %s subscribed" % (DISPUTE, FRAUD))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def subscribed_events(endpoints):
    """Union of enabled_events across endpoints. Pure, given the endpoint list."""
    union = set()
    for ep in endpoints:
        union.update(ep.get("enabled_events") or [])
    return union


def count(session, path, limit):
    """Count a paginated resource up to `limit`."""
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        seen += len(data)
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return seen


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-records", type=int, default=500,
                    help="stop counting disputes and warnings after this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    endpoints = get(s, "/webhook_endpoints", limit=100).get("data", [])
    union = subscribed_events(endpoints)
    disputes = count(s, "/disputes", args.max_records)
    warnings = count(s, "/radar/early_fraud_warnings", args.max_records)

    state, detail = verdict(union, disputes, warnings)
    line = "%-13s %s" % (state, detail)
    if state == "covered":
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  %d dispute(s), %d early fraud warning(s) on this account",
                disputes, warnings)
    if state != "wildcard":
        log.warning("  repair: POST %s/webhook_endpoints/%s", API,
                    endpoints[0]["id"] if endpoints else "<we_id>")
        for t in (DISPUTE, DISPUTE_CLOSED, FRAUD):
            if t not in union:
                log.warning("    -d enabled_events[]=%s", t)
        log.warning("    (enabled_events is replaced wholesale: send the existing "
                    "types too)")
    log.warning("  then sweep GET %s/disputes and %s/radar/early_fraud_warnings "
                "once: neither is retention limited the way /v1/events is",
                API, API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
