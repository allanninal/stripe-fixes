"""Report Stripe subscriptions with no payment method in any of the four slots.

Read only. GET requests only, no writes: give this a RESTRICTED key with read
access to Subscriptions and Customers. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_sub_payment_method")

API = "https://api.stripe.com/v1"


def verdict(sub):
    """Walk Stripe's payment-method resolution order for one subscription.

    Pure, so the order can be tested against the documented one without a network.
    The order is: subscription.default_payment_method, subscription.default_source,
    customer.invoice_settings.default_payment_method, customer.default_source.
    """
    if sub.get("default_payment_method"):
        return ("subscription", "charges subscription.default_payment_method")
    if sub.get("default_source"):
        return ("subscription",
                "charges subscription.default_source, a legacy source object")
    customer = sub.get("customer")
    if not isinstance(customer, dict):
        return ("unknown",
                "customer was not expanded, so the two customer-level defaults "
                "cannot be read; re-run with expand[]=data.customer")
    settings = customer.get("invoice_settings") or {}
    if settings.get("default_payment_method"):
        return ("customer",
                "falls back to customer.invoice_settings.default_payment_method")
    if customer.get("default_source"):
        return ("customer",
                "falls back to customer.default_source, a legacy source object")
    return ("unchargeable",
            "all four resolution slots are null, so the renewal invoice cannot be "
            "paid and Stripe schedules no retry")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_subscriptions(session, status, limit):
    """Walk one status page by page. Read only; every call here is a GET."""
    out = []
    params = {"status": status, "limit": 100, "expand[]": "data.customer"}
    while True:
        page = get(session, "/subscriptions", **params)
        out.extend(page.get("data", []))
        if not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = page["data"][-1]["id"]
    return out[:limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--status", action="append", default=None,
                    help="subscription status to check (repeatable)")
    ap.add_argument("--max", type=int, default=1000,
                    help="stop after this many subscriptions per status")
    args = ap.parse_args()
    statuses = args.status or ["active", "trialing"]

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    checked = 0
    counts = {}
    for status in statuses:
        for sub in page_subscriptions(s, status, args.max):
            checked += 1
            state, detail = verdict(sub)
            counts[state] = counts.get(state, 0) + 1
            if state == "subscription":
                continue
            line = "%-13s %s (%s)  %s" % (state, sub.get("id", "?"), status, detail)
            if state == "customer":
                log.info(line)
                continue
            log.warning(line)
            cus = sub.get("customer")
            cus_id = cus.get("id") if isinstance(cus, dict) else cus
            log.warning("  repair: collect a card with a SetupIntent or the billing "
                        "portal, then POST %s/customers/%s "
                        "-d invoice_settings[default_payment_method]=pm_...",
                        API, cus_id or "cus_...")
            log.warning("  and pin it to the subscription too: POST %s/subscriptions/%s "
                        "-d default_payment_method=pm_...", API, sub.get("id"))

    log.info("%d subscription(s) checked, %d unchargeable, %d relying on a "
             "customer-level default", checked, counts.get("unchargeable", 0),
             counts.get("customer", 0))
    if counts.get("unknown"):
        log.warning("%d row(s) could not be classified: re-run with the customer "
                    "expanded", counts["unknown"])
    return 1 if counts.get("unchargeable") or counts.get("unknown") else 0


if __name__ == "__main__":
    sys.exit(main())
