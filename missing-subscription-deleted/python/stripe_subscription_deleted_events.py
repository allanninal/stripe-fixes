"""Report whether customer.subscription.deleted is subscribed, and who is over-entitled.

Read only. Three GETs, no writes: give this a RESTRICTED key with read access to
Webhook Endpoints and Subscriptions. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_subscription_deleted_events")

API = "https://api.stripe.com/v1"

TARGET = "customer.subscription.deleted"
COMPANION = "customer.subscription.updated"


def verdict(subscribed, canceled, active):
    """Classify entitlement-revocation coverage. Pure, so the rules can be tested.

    `subscribed` is the union of enabled_events across every endpoint, `canceled`
    the number of subscriptions already ended, `active` the number still running.
    Returns (state, detail).
    """
    events = set(subscribed or [])
    if not canceled and not active:
        return ("not-billing",
                "no subscriptions on this account at all, so %s is not a gap "
                "worth reporting yet" % TARGET)
    if "*" in events:
        return ("wildcard",
                "a wildcard subscription covers %s, but it also delivers every "
                "other event type to the same handler." % TARGET)
    if TARGET in events:
        if COMPANION not in events:
            return ("partial",
                    "%s is subscribed but %s is not. You learn that a "
                    "subscription ended, never that a cancellation was scheduled."
                    % (TARGET, COMPANION))
        return ("covered", "%s is subscribed on at least one endpoint" % TARGET)
    if canceled:
        return ("over-entitled",
                "%d canceled subscription(s) and nothing subscribes to %s. Each "
                "one is an account your application was never asked to revoke."
                % (canceled, TARGET))
    return ("unsubscribed",
            "%d active subscription(s) and nothing subscribes to %s. Nothing has "
            "ended yet, so this is a gap rather than a backlog."
            % (active, TARGET))


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


def count_subscriptions(session, status, limit):
    """Count subscriptions in one status, keeping the first few ids for the report."""
    count = 0
    ids = []
    params = {"limit": 100, "status": status}
    while True:
        page = get(session, "/subscriptions", **params)
        data = page.get("data", [])
        for sub in data:
            count += 1
            if len(ids) < 10:
                ids.append(sub["id"])
        if not data or not page.get("has_more") or count >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return count, ids


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-subscriptions", type=int, default=1000,
                    help="stop counting each status after this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    endpoints = get(s, "/webhook_endpoints", limit=100).get("data", [])
    union = subscribed_events(endpoints)
    canceled, canceled_ids = count_subscriptions(s, "canceled", args.max_subscriptions)
    active, _ = count_subscriptions(s, "active", args.max_subscriptions)

    state, detail = verdict(union, canceled, active)
    line = "%-14s %s" % (state, detail)
    if state in ("covered", "not-billing"):
        log.info(line)
        return 0

    log.warning(line)
    if state == "over-entitled":
        for sid in canceled_ids:
            log.warning("  reconcile: %s", sid)
    if state != "wildcard":
        log.warning("  repair: POST %s/webhook_endpoints/%s", API,
                    endpoints[0]["id"] if endpoints else "<we_id>")
        log.warning("    -d enabled_events[]=%s", TARGET)
        log.warning("    -d enabled_events[]=%s", COMPANION)
        log.warning("    (enabled_events is replaced wholesale: send the existing "
                    "types too)")
    log.warning("  then sweep GET %s/subscriptions?status=canceled against your "
                "own entitlement table: subscribing fixes the future only", API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
