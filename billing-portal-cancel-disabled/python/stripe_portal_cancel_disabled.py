"""Report a Stripe Billing Portal configuration with cancellation switched off.

Read only. Two GETs and no writes: give this a RESTRICTED key with read access to
the Customer Portal and Disputes. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_portal_cancel_disabled")

API = "https://api.stripe.com/v1"


def verdict(configuration, cancel_disputes=0, total_disputes=0):
    """Classify one portal configuration. Pure, so it is testable offline.

    `cancel_disputes` is the number of disputes in the window with reason
    subscription_canceled and `total_disputes` every dispute in the same window.
    Returns (state, detail).
    """
    features = ((configuration or {}).get("features") or {})
    cancel = features.get("subscription_cancel") or {}
    update = features.get("payment_method_update") or {}
    config_id = (configuration or {}).get("id", "<no id>")

    enabled = cancel.get("enabled")
    if enabled is None:
        return ("unknown",
                "%s does not report features.subscription_cancel.enabled; read the "
                "configuration rather than assuming either way" % config_id)
    if not enabled:
        if cancel_disputes:
            share = 100.0 * cancel_disputes / total_disputes if total_disputes else 0.0
            return ("cancel-off-disputed",
                    "%s has no cancel button, and %d of %d dispute(s) in the window "
                    "(%.1f%%) are subscription_canceled"
                    % (config_id, cancel_disputes, total_disputes, share))
        return ("cancel-off",
                "%s has no cancel button: the fastest exit a customer has is their "
                "bank" % config_id)
    if not update.get("enabled"):
        return ("update-off",
                "%s can cancel but cannot update a card, so an expired card still "
                "goes to support" % config_id)
    if not (cancel.get("cancellation_reason") or {}).get("enabled"):
        return ("no-reason",
                "%s cancels at %s and collects no cancellation reason: the churn "
                "data is free and is being discarded"
                % (config_id, cancel.get("mode") or "an unspecified point"))
    return ("self-serve",
            "%s: cancel %s, card update on" % (config_id, cancel.get("mode") or "on"))


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def configurations(session):
    """Every portal configuration in whichever mode the key is for."""
    out = []
    params = {"limit": 100}
    while True:
        page = get(session, "/billing_portal/configurations", params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more"):
            break
        params["starting_after"] = data[-1]["id"]
    return out


def dispute_counts(session, since, cap):
    """(disputes citing a cancelled subscription, all disputes) since `since`."""
    cancel = total = 0
    params = {"created[gte]": since, "limit": 100}
    while True:
        page = get(session, "/disputes", params)
        data = page.get("data", [])
        for d in data:
            total += 1
            if d.get("reason") == "subscription_canceled":
                cancel += 1
        if not data or not page.get("has_more") or total >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return cancel, total


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=180,
                    help="dispute window to price the missing button over")
    ap.add_argument("--max-disputes", type=int, default=2000,
                    help="stop paginating after this many disputes")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    configs = configurations(s)
    if not configs:
        log.warning("no portal configuration exists at all, which is a louder "
                    "failure: every portal session create returns 400")
        return 1

    since = int(time.time()) - args.days * 86400
    cancel_disputes, total_disputes = dispute_counts(s, since, args.max_disputes)

    bad = 0
    for config in configs:
        if not config.get("active"):
            continue
        state, detail = verdict(config, cancel_disputes, total_disputes)
        line = "%-20s %s" % (state, detail)
        if state == "self-serve":
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        if state in ("cancel-off", "cancel-off-disputed", "unknown"):
            log.warning("  repair: POST %s/billing_portal/configurations/%s "
                        "-d \"features[subscription_cancel][enabled]=true\" "
                        "-d \"features[subscription_cancel][mode]=at_period_end\" "
                        "-d \"features[subscription_cancel]"
                        "[cancellation_reason][enabled]=true\"",
                        API, config.get("id"))
        if state in ("update-off", "cancel-off", "cancel-off-disputed"):
            log.warning("  and: POST %s/billing_portal/configurations/%s "
                        "-d \"features[payment_method_update][enabled]=true\"",
                        API, config.get("id"))

    log.info("%d active configuration(s), %d needing attention", len(configs), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
