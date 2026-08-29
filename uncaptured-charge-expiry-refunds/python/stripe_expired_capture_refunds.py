"""Report Stripe refunds that Stripe wrote itself when an authorization expired.

Read only. A paginated GET over Refunds and one lookup per candidate charge, no
writes: give this a RESTRICTED key with read access to Refunds and Charges. The
repair is printed, never performed, because this script holds a credential to a
live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_expired_capture_refunds")

API = "https://api.stripe.com/v1"

# Set by Stripe when an uncaptured authorization runs out of time. It is the one
# reason value on the Refund object that nobody in your business can choose, and
# so the one that should never be counted in a customer-facing refund rate.
EXPIRED = "expired_uncaptured_charge"

# The reasons a person picks. Everything here is a real refund.
CUSTOMER_REASONS = ("requested_by_customer", "duplicate", "fraudulent")


def classify(refund, charge=None):
    """Sort one Refund into money a human gave back and money that fell off a card.

    Pure, so the whole rule set is readable here and testable without a network.

    `charge` is the Charge this refund belongs to, or None when it was not looked
    up. That distinction is deliberate: an expired refund confirmed against
    `captured == false` is evidence, and an unconfirmed one is a candidate, and
    collapsing the two is how a finding gets contradicted later.

    Returns (state, detail).
    """
    reason = refund.get("reason")

    if reason == EXPIRED:
        if charge is None:
            return ("expired-unverified",
                    "Stripe wrote this when the authorization expired, but the "
                    "charge was not fetched, so captured is unconfirmed")
        captured = charge.get("captured")
        if captured is False:
            return ("expired",
                    "the authorization expired uncaptured: nobody issued this "
                    "refund and no customer asked for it")
        return ("inconsistent",
                "reason says the authorization expired but the charge reports "
                "captured=%r: read the charge before counting this one" % (captured,))

    if reason in CUSTOMER_REASONS:
        return ("customer", "a real refund (%s), belongs in the refund rate" % reason)

    if reason is None:
        return ("unlabelled",
                "no reason recorded: issued through the API or the Dashboard "
                "without one, so it counts as a real refund until proven otherwise")

    return ("other", "unrecognised reason %r, left in the rate" % (reason,))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_refunds(session, since, limit):
    """Yield refunds created since a unix timestamp, newest first."""
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/refunds", **params)
        rows = page.get("data", [])
        for refund in rows:
            yield refund
            seen += 1
        if not page.get("has_more") or not rows or seen >= limit:
            break
        params["starting_after"] = rows[-1]["id"]


def add(bucket, currency, amount):
    bucket[currency] = bucket.get(currency, 0) + (amount or 0)


def money(bucket):
    if not bucket:
        return "nothing"
    return ", ".join("%.2f %s" % (v / 100.0, k.upper()) for k, v in sorted(bucket.items()))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to scan refunds (default 90)")
    ap.add_argument("--max-refunds", type=int, default=2000,
                    help="stop paginating after this many refunds")
    ap.add_argument("--verify-charges", action="store_true",
                    help="fetch each candidate charge to confirm captured is false")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    charges = {}

    states = {}
    all_money = {}
    expired_money = {}
    scanned = 0

    for refund in page_refunds(s, since, args.max_refunds):
        scanned += 1
        currency = refund.get("currency") or "???"
        add(all_money, currency, refund.get("amount"))

        charge = None
        if args.verify_charges and refund.get("reason") == EXPIRED:
            charge_id = refund.get("charge")
            if isinstance(charge_id, str):
                if charge_id not in charges:
                    charges[charge_id] = get(s, "/charges/" + charge_id)
                charge = charges[charge_id]

        state, detail = classify(refund, charge)
        states[state] = states.get(state, 0) + 1

        if state in ("expired", "expired-unverified"):
            add(expired_money, currency, refund.get("amount"))
            log.warning("%-18s %s  %s", state, refund.get("id", "?"), detail)
        elif state == "inconsistent":
            log.warning("%-18s %s  %s", state, refund.get("id", "?"), detail)

    if not scanned:
        log.info("no refunds in the last %d day(s)", args.days)
        return 0

    log.info("%d refund(s) in %d day(s): %s", scanned, args.days,
             ", ".join("%d %s" % (n, k) for k, n in sorted(states.items())))
    log.info("refunded in total: %s", money(all_money))

    if not expired_money:
        log.info("nothing refunded because an authorization expired")
        return 0

    log.warning("refunded because an authorization expired: %s", money(expired_money))
    for currency, amount in sorted(expired_money.items()):
        total = all_money.get(currency, 0)
        if total:
            log.warning("  %s: %.1f%% of everything refunded in this window",
                        currency.upper(), 100.0 * amount / total)
    log.warning("repair: exclude reason=%s from the customer-facing refund rate "
                "and report it as an operational number instead", EXPIRED)
    log.warning("repair: fix the capture pipeline; the real deadline is "
                "capture_before on the charge, not created plus seven days")
    log.warning("repair: subscribe to charge.refund.updated and alert when a "
                "refund arrives carrying this reason")
    return 1


if __name__ == "__main__":
    sys.exit(main())
