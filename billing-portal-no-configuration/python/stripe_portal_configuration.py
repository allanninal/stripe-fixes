"""Report a missing or unusable Stripe Billing Portal configuration.

Read only. Two GETs and no writes: give this a RESTRICTED key with read access to
the Customer Portal and Subscriptions. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_portal_configuration")

API = "https://api.stripe.com/v1"

PORTAL_SETTINGS = "https://dashboard.stripe.com/settings/billing/portal"


def verdict(configurations, active_subscriptions=0):
    """Classify the account's portal configuration. Pure, so it is testable offline.

    `configurations` is the list from /v1/billing_portal/configurations and
    `active_subscriptions` the number of customers who can press the button.
    Returns (state, detail).
    """
    configs = list(configurations or [])
    usable = [c for c in configs if c.get("is_default") and c.get("active")]
    if usable:
        return ("configured",
                "default configuration %s is active; portal sessions resolve"
                % usable[0].get("id", "<no id>"))
    if not configs:
        if active_subscriptions:
            return ("erroring",
                    "no portal configuration exists and %d active subscription(s) "
                    "can reach the portal: every session create is failing with 400 "
                    "right now" % active_subscriptions)
        return ("missing",
                "no portal configuration exists. The first session created without "
                "an explicit configuration will fail with 400.")
    active = [c for c in configs if c.get("active")]
    if active:
        return ("explicit-only",
                "%d active configuration(s) but none is the default (%s). A session "
                "created without configuration=... fails with 400."
                % (len(active), ", ".join(c.get("id", "?") for c in active[:3])))
    return ("inactive-default",
            "%d configuration(s) exist and none of them is active, so none can be "
            "used to open the portal" % len(configs))


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def configurations(session):
    """Every portal configuration on the account, in whichever mode the key is for."""
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


def active_subscription_count(session, cap):
    count = 0
    params = {"status": "active", "limit": 100}
    while True:
        page = get(session, "/subscriptions", params)
        data = page.get("data", [])
        count += len(data)
        if not data or not page.get("has_more") or count >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return count


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-subscriptions", type=int, default=2000,
                    help="stop counting active subscriptions after this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2
    if key.startswith("sk_test") or key.startswith("rk_test"):
        log.warning("this is a test-mode key: a result here says nothing about live, "
                    "which is where this failure happens")

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    configs = configurations(s)
    subs = active_subscription_count(s, args.max_subscriptions)
    state, detail = verdict(configs, subs)

    line = "%-16s %s" % (state, detail)
    if state == "configured":
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  %d active subscription(s) can reach the portal", subs)
    log.warning("  repair: save the portal settings once, in this mode, at %s",
                PORTAL_SETTINGS)
    log.warning("  or create one over the API and pass its id explicitly:")
    log.warning("  POST %s/billing_portal/configurations -d "
                "\"features[invoice_history][enabled]=true\" ...", API)
    log.warning("  then POST %s/billing_portal/sessions -d customer=cus_... "
                "-d configuration=bpc_...", API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
