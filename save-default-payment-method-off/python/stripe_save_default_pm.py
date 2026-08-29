"""Report Stripe subscriptions that will have nothing to charge at renewal.

Read only. One paginated GET per status, no writes: give this a RESTRICTED key
with read access to Subscriptions and Customers. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_save_default_pm")

API = "https://api.stripe.com/v1"

FAILED_STATUSES = ("past_due", "unpaid")


def verdict(subscription):
    """Classify one subscription. Pure, so the rules can be tested without a network.

    Returns (state, detail). The subscription's `customer` must be expanded; when
    it is only an id there is no way to know whether a customer-level default
    exists, and guessing either way is worse than saying so.
    """
    settings = subscription.get("payment_settings") or {}
    save = settings.get("save_default_payment_method")

    # Absent is the same as "off": Stripe omits the field when it was never set,
    # which is how almost every affected subscription actually looks.
    if save not in (None, "off", "on_subscription"):
        return ("unknown", "unrecognised save_default_payment_method %r" % (save,))
    if save == "on_subscription":
        return ("on", "the card that pays an invoice becomes the subscription default")

    if subscription.get("default_payment_method"):
        return ("saved", "the flag is off, but a default is already set on the "
                         "subscription")

    customer = subscription.get("customer")
    if not isinstance(customer, dict):
        return ("unknown",
                "customer is not expanded, so the fallback default cannot be read; "
                "re-read with expand[]=data.customer")

    invoice_settings = customer.get("invoice_settings") or {}
    if invoice_settings.get("default_payment_method"):
        return ("fallback",
                "nothing on the subscription; renewals fall back to the customer "
                "default. Working, and one refactor away from not working.")

    if subscription.get("status") in FAILED_STATUSES:
        return ("failing",
                "status %s with no payment method on the subscription and none on "
                "the customer. The renewal has already failed."
                % subscription.get("status"))

    return ("stranded",
            "no payment method on the subscription and none on the customer. The "
            "next renewal has nothing to charge.")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    seen = 0
    params = dict(params, limit=100)
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-subscriptions", type=int, default=5000,
                    help="stop paginating each status after this many subscriptions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    counts = {}
    flagged = []
    total = 0
    for status in ("active",) + FAILED_STATUSES:
        for sub in page_all(s, "/subscriptions", args.max_subscriptions,
                            status=status, **{"expand[]": "data.customer"}):
            total += 1
            state, detail = verdict(sub)
            counts[state] = counts.get(state, 0) + 1
            if state in ("stranded", "failing", "unknown"):
                flagged.append((state, sub["id"], detail))

    if not total:
        log.info("no subscriptions for this key's mode")
        return 0

    for state, sub_id, detail in flagged[:25]:
        log.warning("%-9s %s  %s", state, sub_id, detail)
        log.warning("  repair: POST %s/subscriptions/%s "
                    "-d \"payment_settings[save_default_payment_method]=on_subscription\"",
                    API, sub_id)

    bad = counts.get("stranded", 0) + counts.get("failing", 0)
    if counts.get("fallback"):
        log.info("%d subscription(s) rely on the customer default; they work until "
                 "the signup flow stops writing it", counts["fallback"])
    log.info("%d subscription(s), %d stranded, %d already failing",
             total, counts.get("stranded", 0), counts.get("failing", 0))
    if not bad:
        return 0
    log.warning("set it at creation so this stops recurring:")
    log.warning("  POST %s/subscriptions "
                "-d \"payment_settings[save_default_payment_method]=on_subscription\"",
                API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
