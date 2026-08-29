"""Report Stripe invoice items left pending with no invoice coming to collect them.

Read only. Two GETs, no writes: give this a RESTRICTED key with read access to
Invoices and Subscriptions. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_pending_invoice_items")

API = "https://api.stripe.com/v1"

FRESH_DAYS = 1     # created today; a manual invoice may be seconds behind it
SWEEP_DAYS = 35    # a monthly cycle plus slack: one invoice should have run
STALE_DAYS = 60    # two cycles missed, or an annual plan worth confirming


def verdict(age_days, has_active_subscription, item_count):
    """Classify one customer's pending invoice items. Pure, so it can be tested.

    `age_days` is the age of that customer's oldest pending item, and
    `has_active_subscription` whether any invoice is still scheduled for them at
    all. Returns (state, detail).
    """
    stack = "%d pending item(s), oldest %.0fd" % (item_count, age_days)
    if not has_active_subscription:
        if age_days < FRESH_DAYS:
            return ("fresh",
                    "%s, no active subscription. Probably an invoice being built "
                    "right now; check again tomorrow." % stack)
        return ("orphaned",
                "%s, and no active subscription to raise an invoice. Nothing will "
                "ever sweep these up." % stack)
    if age_days < SWEEP_DAYS:
        return ("waiting", "%s, next invoice still due" % stack)
    if age_days < STALE_DAYS:
        return ("aging",
                "%s, past a monthly cycle. Fine on an annual plan, a miss on a "
                "monthly one." % stack)
    return ("stalled",
            "%s, past two monthly cycles with a live subscription. Confirm the "
            "billing interval before assuming this is benign." % stack)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def paginate(session, path, **params):
    params = dict(params, limit=params.get("limit", 100))
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for row in data:
            yield row
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def bucket_by_customer(items):
    """Group pending items per customer, keeping the oldest date and the totals.

    Amounts are kept per currency. Summing across currencies produces a number
    that is wrong in a way nobody can see, which is how a report gets distrusted.
    """
    buckets = {}
    for it in items:
        cus = it.get("customer")
        if not cus:
            continue
        b = buckets.setdefault(cus, {"count": 0, "oldest": None, "amounts": {}})
        b["count"] += 1
        date = it.get("date") or it.get("created")
        if date is not None and (b["oldest"] is None or date < b["oldest"]):
            b["oldest"] = date
        cur = (it.get("currency") or "???").upper()
        b["amounts"][cur] = b["amounts"].get(cur, 0) + (it.get("amount") or 0)
    return buckets


def has_active_subscription(session, customer):
    page = get(session, "/subscriptions", customer=customer, status="active", limit=1)
    return bool(page.get("data"))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-items", type=int, default=5000,
                    help="stop paginating after this many pending invoice items")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    items = []
    for it in paginate(s, "/invoiceitems", pending="true"):
        items.append(it)
        if len(items) >= args.max_items:
            break

    buckets = bucket_by_customer(items)
    now = time.time()
    findings = 0
    exposure = {}

    for cus, b in sorted(buckets.items(), key=lambda kv: kv[1]["oldest"] or 0):
        age = 0.0 if b["oldest"] is None else (now - b["oldest"]) / 86400.0
        live = has_active_subscription(s, cus)
        state, detail = verdict(age, live, b["count"])
        money = ", ".join("%s %d" % (c, v) for c, v in sorted(b["amounts"].items()))

        line = "%-11s %s  %s  [%s minor unit(s)]" % (state, cus, detail, money)
        if state in ("waiting", "fresh"):
            log.info(line)
            continue

        findings += 1
        for c, v in b["amounts"].items():
            exposure[c] = exposure.get(c, 0) + v
        log.warning(line)
        if state == "orphaned":
            log.warning("  raise one invoice for this customer to sweep every "
                        "pending item onto it, then finalize it; or delete the "
                        "items that are no longer owed while they are unattached")
        else:
            log.warning("  confirm the billing interval: GET %s/subscriptions"
                        "?customer=%s&status=active", API, cus)

    log.info("%d customer(s) with pending items, %d needing a decision", len(buckets),
             findings)
    for c, v in sorted(exposure.items()):
        log.info("  unbilled exposure: %s %d minor unit(s)", c, v)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
