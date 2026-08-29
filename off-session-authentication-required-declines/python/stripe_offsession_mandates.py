"""Report customers whose saved cards cannot be charged off-session.

Read only. GET requests only, no writes: give this a RESTRICTED key with read
access to PaymentIntents, SetupIntents and PaymentMethods. The repair is printed,
never performed, because this script holds a credential to a live payments
account.
"""
import argparse
import collections
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_offsession_mandates")

API = "https://api.stripe.com/v1"

# Both mean the issuer wanted the cardholder present. The second is what Stripe
# returns when the integration never handled the step-up at all.
STEP_UP = ("authentication_required", "authentication_not_handled")


def is_step_up_decline(intent):
    """True when this intent failed for want of authentication. Pure.

    The generic `code` on these is `card_declined`, identical to an ordinary
    decline, so the distinguishing value is one level down in `decline_code`.
    Anything grouping by `code` buries this failure inside the normal decline
    rate.
    """
    err = intent.get("last_payment_error") or {}
    return err.get("decline_code") in STEP_UP


def has_mandate(setup_intents):
    """True when some SetupIntent for this customer actually produced a mandate.

    Pure. A SetupIntent that was created and abandoned proves nothing: only one
    that reached `succeeded` and carries a non-null `mandate` records that the
    customer authenticated on-session and agreed to be charged later.
    """
    return any(si.get("status") == "succeeded" and si.get("mandate")
               for si in setup_intents)


def verdict(declines, saved_cards, setup_intents):
    """Classify one customer. Pure.

    Two states share a symptom and need different repairs: a decline with no
    mandate is a card-saving bug, and a decline despite a mandate is the issuer
    stepping up anyway. Retrying off-session is wrong for both.
    """
    mandated = has_mandate(setup_intents)
    if declines and not mandated:
        return ("unmandated",
                "%d off-session decline(s) and no succeeded SetupIntent carrying "
                "a mandate: the card was attached directly, so every retry "
                "declines identically" % declines)
    if declines:
        return ("stepped_up",
                "%d off-session decline(s) despite a mandate on file: the issuer "
                "asked for the cardholder anyway, so this charge has to be "
                "finished on-session" % declines)
    if saved_cards and not mandated:
        return ("at_risk",
                "%d saved card(s) with no mandate behind them: nothing has failed "
                "yet only because nothing has been charged off-session yet"
                % saved_cards)
    if saved_cards:
        return ("covered", "saved cards are backed by a mandate")
    return ("clear", "no saved cards to charge off-session")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to " + path)
    r.raise_for_status()
    return r.json()


def declines_by_customer(session, since, cap):
    """Tally step-up declines per customer id over the window."""
    counts = collections.Counter()
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/payment_intents", **params)
        rows = page.get("data", [])
        for pi in rows:
            seen += 1
            if pi.get("customer") and is_step_up_decline(pi):
                counts[pi["customer"]] += 1
        if not rows or not page.get("has_more") or seen >= cap:
            break
        params["starting_after"] = rows[-1]["id"]
    return counts, seen


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to look for declines")
    ap.add_argument("--max-intents", type=int, default=5000,
                    help="stop sampling after this many intents")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    declines, sampled = declines_by_customer(s, since, args.max_intents)
    if not declines:
        log.info("sampled %d intent(s), no authentication_required declines", sampled)
        return 0

    unmandated = stepped_up = 0
    for customer, n in declines.most_common():
        sis = get(s, "/setup_intents", customer=customer, limit=100).get("data", [])
        cards = get(s, "/payment_methods", customer=customer, type="card",
                    limit=100).get("data", [])
        state, detail = verdict(n, len(cards), sis)
        log.warning("%-11s %s  %s", state, customer, detail)
        if state == "unmandated":
            unmandated += 1
            log.warning("  repair: send a SetupIntent link so the customer "
                        "re-authenticates, then charge with off_session=true "
                        "and confirm=true")
        elif state == "stepped_up":
            stepped_up += 1
            log.warning("  repair: bring the customer back on-session for this "
                        "charge; do not schedule another off-session retry")

    log.warning("  repair: stop attaching cards directly. Save with a SetupIntent "
                "using usage=off_session, or setup_future_usage=off_session during "
                "a payment")
    log.info("%d customer(s) declining: %d unmandated, %d stepped up",
             len(declines), unmandated, stepped_up)
    return 1


if __name__ == "__main__":
    sys.exit(main())
