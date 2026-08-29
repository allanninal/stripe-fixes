"""Report Stripe subscriptions stuck in incomplete before the 23-hour deadline.

Read only. One GET request, no writes: give this a RESTRICTED key with read
access to Subscriptions. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_incomplete_subs")

API = "https://api.stripe.com/v1"

# Stripe holds an unpaid first invoice open for exactly 23 hours, then moves the
# subscription to the terminal incomplete_expired and voids the invoice.
WINDOW = 82800
# The last stretch before that, where a human can still rescue an individual one.
LAST_CHANCE = 7200


def verdict(sub, now, grace=3600):
    """Classify one incomplete subscription by how long it has sat unconfirmed.

    Pure, so the 23-hour boundary can be tested without a network. `grace` is how
    long a real customer might plausibly spend on the confirmation step; anything
    older than that was never confirmed at all.
    """
    created = sub.get("created")
    if not isinstance(created, (int, float)):
        return ("unknown", "no created timestamp, so this row cannot be aged")
    age = now - created
    if age >= WINDOW:
        return ("expired",
                "%.1f h old: past the 23 hour window, so the invoice is voided and "
                "this record cannot be revived" % (age / 3600.0))
    if age >= WINDOW - LAST_CHANCE:
        return ("expiring",
                "%.1f h old: under %.1f h left before Stripe expires it"
                % (age / 3600.0, (WINDOW - age) / 3600.0))
    if age >= grace:
        return ("stalled",
                "%.1f h old and still unconfirmed: the first PaymentIntent was "
                "never confirmed by the client" % (age / 3600.0))
    return ("pending",
            "%.0f min old: a customer may still be on the confirmation step"
            % (age / 60.0))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    """Walk a list endpoint. Read only; every call here is a GET."""
    out = []
    params = dict(params, limit=100)
    while True:
        page = get(session, path, **params)
        out.extend(page.get("data", []))
        if not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = page["data"][-1]["id"]
    return out[:limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--grace", type=int, default=3600,
                    help="seconds a confirmation may plausibly take (default 3600)")
    ap.add_argument("--max", type=int, default=1000,
                    help="stop after this many subscriptions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    subs = page_all(s, "/subscriptions", args.max, status="incomplete")
    if not subs:
        log.info("no incomplete subscriptions for this key's mode")
        return 0

    now = time.time()
    counts = {}
    for sub in subs:
        state, detail = verdict(sub, now, args.grace)
        counts[state] = counts.get(state, 0) + 1
        line = "%-8s %s  %s" % (state, sub.get("id", "?"), detail)
        if state == "pending":
            log.info(line)
            continue
        log.warning(line)
        if state == "expired":
            log.warning("  repair: unrecoverable. Create a new subscription: "
                        "POST %s/subscriptions -d customer=%s -d items[0][price]=... "
                        "-d default_payment_method=...",
                        API, sub.get("customer", "cus_..."))
        else:
            log.warning("  repair: confirm the first invoice's PaymentIntent client "
                        "side before %s/subscriptions/%s expires", API, sub.get("id"))

    bad = len(subs) - counts.get("pending", 0)
    log.info("%d incomplete subscription(s), %d past the 23 hour window, %d stalled",
             len(subs), counts.get("expired", 0), counts.get("stalled", 0))
    if bad:
        log.warning("structural fix: create with payment_behavior=default_incomplete "
                    "and confirm the invoice's client secret in the same session")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
