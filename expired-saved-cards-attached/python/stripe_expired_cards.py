"""Report expired card PaymentMethods still attached to Stripe customers.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Customers, Subscriptions and PaymentMethods. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import datetime as dt
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_expired_cards")

API = "https://api.stripe.com/v1"


def verdict(exp_month, exp_year, now_year, now_month, is_default=False):
    """Classify one saved card against today. Pure, so the boundary is testable.

    A card is valid through the END of its expiry month, so the same month in
    the same year is still good. Returns (state, detail).
    """
    if not exp_month or not exp_year:
        return ("unreadable",
                "no exp_month/exp_year on this payment method: it cannot be aged")
    label = "%02d/%d" % (int(exp_month), int(exp_year))
    expired = (exp_year < now_year
               or (exp_year == now_year and exp_month < now_month))
    if expired and is_default:
        return ("expired-default",
                "expired %s and it is the billing default: the next renewal "
                "fails with expired_card" % label)
    if expired:
        return ("expired",
                "expired %s and still attached. Nothing prunes it, so your UI "
                "keeps showing it as a card on file." % label)
    if exp_year == now_year and exp_month == now_month:
        return ("last-month",
                "valid to the end of %s and then it stops. This is the month a "
                "nudge still prevents the decline." % label)
    return ("valid", "good to %s" % label)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def billed_customers(session, limit):
    """Customer ids with an active subscription, and the default PM per customer."""
    out = {}
    params = {"limit": 100, "status": "active"}
    while True:
        page = get(session, "/subscriptions", **params)
        data = page.get("data", [])
        for sub in data:
            cus = sub.get("customer")
            if isinstance(cus, dict):
                cus = cus.get("id")
            if not cus:
                continue
            defaults = out.setdefault(cus, set())
            pm = sub.get("default_payment_method")
            if isinstance(pm, dict):
                pm = pm.get("id")
            if pm:
                defaults.add(pm)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-customers", type=int, default=500,
                    help="stop after this many billed customers")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    today = dt.date.today()
    customers = billed_customers(s, args.max_customers)
    if not customers:
        log.info("no active subscriptions for this key's mode")
        return 0

    bad = 0
    for cus, sub_defaults in customers.items():
        customer = get(s, "/customers/" + cus)
        settings = customer.get("invoice_settings") or {}
        defaults = set(sub_defaults)
        if settings.get("default_payment_method"):
            defaults.add(settings["default_payment_method"])

        pms = get(s, "/payment_methods", customer=cus, type="card",
                  limit=100).get("data", [])
        for pm in pms:
            card = pm.get("card") or {}
            state, detail = verdict(card.get("exp_month"), card.get("exp_year"),
                                    today.year, today.month,
                                    pm.get("id") in defaults)
            line = "%-15s %s  %s  %s" % (state, cus, pm.get("id"), detail)
            if state in ("valid",):
                log.info(line)
                continue
            if state == "last-month":
                log.info(line)
                continue
            bad += 1
            log.warning(line)
            log.warning("  repair: POST %s/payment_methods/%s/detach, then send "
                        "the customer a Customer Portal session or a SetupIntent "
                        "to add a new card", API, pm.get("id"))
            log.warning("  and subscribe to payment_method.automatically_updated "
                        "so network updates refresh your local exp_month/exp_year")

    log.info("%d billed customer(s), %d expired card(s) still attached",
             len(customers), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
