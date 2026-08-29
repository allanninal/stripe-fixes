"""Report Stripe Checkout Sessions that are complete but were never paid.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Checkout Sessions and PaymentIntents. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_unpaid_complete_sessions")

API = "https://api.stripe.com/v1"

# Payment methods that settle after the session completes rather than during it.
DELAYED = ("us_bank_account", "sepa_debit", "boleto", "konbini", "oxxo")

# PaymentIntent states that mean the async payment is already lost.
DEAD_INTENT = ("requires_payment_method", "canceled")


def verdict(status, payment_status, intent_status=None, methods=None):
    """Classify one Checkout Session. Pure, so the rules can be tested offline.

    Takes the session's `status` and `payment_status`, the expanded
    `payment_intent.status` where one was fetched, and `payment_method_types`.
    Returns (state, detail).
    """
    if status != "complete":
        return ("skipped",
                "status is %r; this check only looks at complete sessions" % status)
    if payment_status == "no_payment_required":
        return ("free", "nothing to collect on this session")
    if payment_status == "paid":
        return ("paid", "payment_status is paid; fulfilment is safe")

    delayed = sorted(m for m in (methods or []) if m in DELAYED)
    note = (" Delayed method(s) on the session: %s." % ", ".join(delayed)) if delayed else ""
    if intent_status == "processing":
        return ("processing",
                "complete but unpaid, and the PaymentIntent is still processing. "
                "Wait for checkout.session.async_payment_succeeded before "
                "fulfilling." + note)
    if intent_status in DEAD_INTENT:
        return ("failed",
                "complete but unpaid, and the PaymentIntent is %s: the payment "
                "failed after the session completed. Anything fulfilled against "
                "it has to be unwound." % intent_status + note)
    return ("unpaid",
            "complete but payment_status is unpaid, and the PaymentIntent state is "
            "%s. Do not treat completed as paid." % (intent_status or "unknown") + note)


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def complete_sessions(session, since, cap):
    """Every session Stripe considers complete in the window."""
    out = []
    params = {"status": "complete", "created[gte]": since, "limit": 100}
    while True:
        page = get(session, "/checkout/sessions", params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def intent_status(session, cs_id):
    """Expand the PaymentIntent for one session, so a failure can be told from a wait."""
    cs = get(session, "/checkout/sessions/" + cs_id, {"expand[]": "payment_intent"})
    intent = cs.get("payment_intent")
    if isinstance(intent, dict):
        return intent.get("status")
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to look for complete sessions")
    ap.add_argument("--max-sessions", type=int, default=5000,
                    help="stop paginating after this many sessions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    failed = 0
    waiting = 0
    for cs in complete_sessions(s, since, args.max_sessions):
        if cs.get("payment_status") != "unpaid":
            continue
        pi = intent_status(s, cs["id"])
        state, detail = verdict(cs.get("status"), cs.get("payment_status"), pi,
                                cs.get("payment_method_types"))
        log.warning("%-11s %-28s %s", state, cs["id"], detail)
        if state == "failed":
            failed += 1
        else:
            waiting += 1

    log.info("%d session(s) fulfilled against a payment that has already failed, "
             "%d still in flight", failed, waiting)
    if failed or waiting:
        log.warning("  repair: gate fulfilment on payment_status != \"unpaid\", not "
                    "on the completed event alone")
        log.warning("  and subscribe the event destination to "
                    "checkout.session.async_payment_succeeded and "
                    "checkout.session.async_payment_failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
