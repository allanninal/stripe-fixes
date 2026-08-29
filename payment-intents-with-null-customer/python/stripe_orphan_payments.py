"""Report Stripe payments with no Customer attached, and the repeat buyers in them.

Read only. Two paginated GETs, no writes: give this a RESTRICTED key with read
access to PaymentIntents and Charges. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_orphan_payments")

API = "https://api.stripe.com/v1"

DOMINANT = 0.5   # share of orphaned intents above which guest checkout is the default path


def verdict(total, orphans, repeat_fingerprints):
    """Classify the window. Pure, so the ordering can be tested without a network.

    `repeat_fingerprints` counts distinct cards that paid more than once with no
    Customer attached. It outranks the share on purpose: a share is an argument
    about how much guest checkout you meant to have, and a repeat fingerprint is a
    named buyer whose history Stripe was not allowed to keep.
    """
    if not total:
        return ("unknown", "no payment intents in the window; nothing to judge")
    share = orphans / float(total)
    if repeat_fingerprints:
        return ("repeat",
                "%d card(s) paid more than once with no customer attached. Those are "
                "returning buyers scored as strangers every time." % repeat_fingerprints)
    if share >= DOMINANT:
        return ("dominant",
                "%d of %d payment intent(s), %.0f%%, have no customer. Guest checkout "
                "is the default path, not an option." % (orphans, total, share * 100))
    if orphans:
        return ("guests",
                "%d of %d payment intent(s) have no customer. Expected if guest "
                "checkout is deliberate; costly if it is not." % (orphans, total))
    return ("clear", "%d payment intent(s), 0 with no customer attached" % total)


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


def repeat_cards(session, since, limit):
    """Group customerless successful charges by card fingerprint.

    The fingerprint is stable for one card across payments, so a count above one
    is the same physical card paying twice as two different strangers. It is not
    stable across a reissue, which makes this an undercount rather than a guess.
    """
    counts = {}
    for ch in page_all(session, "/charges", limit, **{"created[gte]": since}):
        if ch.get("customer") or ch.get("status") != "succeeded":
            continue
        card = ((ch.get("payment_method_details") or {}).get("card") or {})
        fp = card.get("fingerprint")
        if fp:
            counts[fp] = counts.get(fp, 0) + 1
    return {fp: n for fp, n in counts.items() if n > 1}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to read payment intents and charges")
    ap.add_argument("--max-objects", type=int, default=5000,
                    help="stop paginating each list after this many objects")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400

    total = orphans = orphan_amount = unsaveable = 0
    for pi in page_all(s, "/payment_intents", args.max_objects,
                       **{"created[gte]": since}):
        total += 1
        if pi.get("customer"):
            continue
        orphans += 1
        orphan_amount += pi.get("amount") or 0
        if not pi.get("setup_future_usage"):
            unsaveable += 1

    repeats = repeat_cards(s, since, args.max_objects)
    state, detail = verdict(total, orphans, len(repeats))

    line = "%-11s %s" % (state, detail)
    if state in ("clear", "unknown"):
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  %d in the smallest currency unit is unattributed to anyone",
                orphan_amount)
    log.warning("  %d of the orphans also had no setup_future_usage, so the card "
                "was discarded too", unsaveable)
    for fp, n in sorted(repeats.items(), key=lambda kv: -kv[1])[:10]:
        log.warning("  fingerprint %s paid %d times as a stranger", fp, n)
    log.warning("  repair: look the customer up before creating the intent")
    log.warning("  POST %s/payment_intents -d customer=cus_XXX "
                "-d setup_future_usage=off_session", API)
    log.warning("  in Checkout: pass an existing customer, or customer_creation=always")
    return 1


if __name__ == "__main__":
    sys.exit(main())
