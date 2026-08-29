"""Report whether payout.failed is subscribed, and whether payouts already failed.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Webhook Endpoints, Payouts and Events. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_payout_events")

API = "https://api.stripe.com/v1"

TARGET = "payout.failed"
COMPANION = "payout.paid"


def verdict(subscribed, failed_payouts):
    """Classify payout-failure coverage. Pure, so the rules can be tested.

    `subscribed` is the union of enabled_events across every endpoint;
    `failed_payouts` is how many payouts are already in status failed.
    Returns (state, detail).
    """
    events = set(subscribed or [])
    if "*" in events:
        return ("wildcard",
                "a wildcard subscription covers %s, but it also delivers every "
                "other event type to the same handler." % TARGET)
    if TARGET in events:
        if COMPANION not in events:
            return ("partial",
                    "%s is subscribed but %s is not. Reconciliation cannot tell a "
                    "quiet week from a broken one." % (TARGET, COMPANION))
        return ("covered", "%s is subscribed on at least one endpoint" % TARGET)
    if failed_payouts:
        return ("blind",
                "%d payout(s) already failed and nothing subscribes to %s. The "
                "external account is disabled until the details are updated."
                % (failed_payouts, TARGET))
    return ("unsubscribed",
            "nothing subscribes to %s. No failures in the window yet, so this is "
            "a gap rather than an incident." % TARGET)


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


def failed_payouts(session, limit):
    """Count payouts currently in status failed, and collect their failure codes."""
    codes = {}
    count = 0
    params = {"limit": 100, "status": "failed"}
    while True:
        page = get(session, "/payouts", **params)
        data = page.get("data", [])
        for p in data:
            count += 1
            code = p.get("failure_code") or "unknown"
            codes[code] = codes.get(code, 0) + 1
        if not data or not page.get("has_more") or count >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return count, codes


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-payouts", type=int, default=500,
                    help="stop counting failed payouts after this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    endpoints = get(s, "/webhook_endpoints", limit=100).get("data", [])
    union = subscribed_events(endpoints)
    count, codes = failed_payouts(s, args.max_payouts)

    state, detail = verdict(union, count)
    line = "%-13s %s" % (state, detail)
    if state == "covered":
        log.info(line)
        return 0

    log.warning(line)
    if codes:
        log.warning("  failure codes seen: %s",
                    ", ".join("%s x%d" % (c, n) for c, n in sorted(codes.items())))
    if state in ("blind", "unsubscribed", "partial"):
        target = endpoints[0]["id"] if endpoints else "<we_id>"
        log.warning("  repair: POST %s/webhook_endpoints/%s "
                    "-d enabled_events[]=%s -d enabled_events[]=%s",
                    API, target, TARGET, COMPANION)
        log.warning("  on Connect, add a connected-accounts destination carrying "
                    "%s and account.external_account.updated", TARGET)
    return 1


if __name__ == "__main__":
    sys.exit(main())
