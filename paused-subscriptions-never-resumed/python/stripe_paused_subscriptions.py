"""Report paused subscriptions, sorted by whether they can still be resumed.

Read only. One GET, no writes: give this a RESTRICTED key with read access to
Subscriptions and Customers. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_paused_subscriptions")

API = "https://api.stripe.com/v1"
DAY = 86400
INTERVALS = {"day": DAY, "week": 7 * DAY, "month": 30 * DAY, "year": 365 * DAY}


def interval_seconds(sub):
    """Length of one billing interval, from the first item's recurring price.

    Falls back to 30 days when the price is not expanded or the interval is one
    we do not recognise: a paused subscription with an unknown interval is still
    worth ageing, and guessing monthly is the conservative guess.
    """
    items = (sub.get("items") or {}).get("data") or []
    if not items:
        return 30 * DAY
    price = items[0].get("price") or items[0].get("plan") or {}
    recurring = price.get("recurring") or price
    unit = INTERVALS.get(recurring.get("interval"))
    if not unit:
        return 30 * DAY
    return unit * (recurring.get("interval_count") or 1)


def has_payment_method(sub):
    """True when Stripe has something to charge the moment this is resumed.

    Same four places Stripe itself looks, in the same order.
    """
    customer = sub.get("customer")
    if not isinstance(customer, dict):
        customer = {}
    return bool(sub.get("default_payment_method")
                or sub.get("default_source")
                or (customer.get("invoice_settings") or {}).get("default_payment_method")
                or customer.get("default_source"))


def verdict(sub, now):
    """Classify one paused subscription. Pure, so the rules can be tested.

    Returns (state, detail).
    """
    if sub.get("status") != "paused":
        return ("not-paused",
                "status is %r; paused is only reachable from a trial that ended "
                "with no payment method" % (sub.get("status"),))
    if has_payment_method(sub):
        return ("resumable",
                "a payment method is already on file. The only thing keeping this "
                "paused is the resume nobody performed.")
    days = int((now - (sub.get("trial_end") or sub.get("start_date") or now)) // DAY)
    if now - (sub.get("trial_end") or sub.get("start_date") or now) > interval_seconds(sub):
        return ("stale",
                "paused %d day(s), longer than one billing interval. This is "
                "churn that was never recorded as churn." % days)
    return ("recent",
            "paused %d day(s), inside one billing interval. The win-back window "
            "is still open." % days)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def paused_subscriptions(session, limit):
    """Page every paused subscription, customer expanded so cards are visible."""
    out = []
    params = {"status": "paused", "limit": 100, "expand[]": "data.customer"}
    while True:
        page = get(session, "/subscriptions", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-subscriptions", type=int, default=1000,
                    help="stop after this many paused subscriptions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    subs = paused_subscriptions(s, args.max_subscriptions)
    now = int(time.time())
    counts = {}
    for sub in subs:
        state, detail = verdict(sub, now)
        counts[state] = counts.get(state, 0) + 1
        log.warning("%-10s %s  %s", state, sub["id"], detail)
        if state == "resumable":
            log.warning("  repair: POST %s/subscriptions/%s -d pause_collection= "
                        "-d default_payment_method={pm}", API, sub["id"])
        elif state == "stale":
            log.warning("  repair: count it as churn, or send a billing portal "
                        "link before you do")

    log.info("%d paused subscription(s): %d resumable, %d stale",
             len(subs), counts.get("resumable", 0), counts.get("stale", 0))
    if subs:
        log.info("handle customer.subscription.paused so this list has an owner")
    return 1 if subs else 0


if __name__ == "__main__":
    sys.exit(main())
