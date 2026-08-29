"""Report Stripe subscriptions frozen on an unanswered 3DS authentication.

Read only. One paginated GET with an expansion, no writes: give this a
RESTRICTED key with read access to Subscriptions, Invoices and PaymentIntents.
The repair is printed, never performed, because this script holds a credential
to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_sca_stuck_subs")

API = "https://api.stripe.com/v1"


def intent_of(invoice):
    """Find the PaymentIntent on an invoice across the Basil API change. Pure.

    Before 2025-03-31.basil the intent hangs off `invoice.payment_intent`. On
    Basil and later it is reached through the invoice's `payments` collection.
    A check that only knows one shape reads every row as unexpanded on the
    other, which looks like a clean account rather than a broken query.

    Returns the intent dict, or None.
    """
    if not isinstance(invoice, dict):
        return None
    intent = invoice.get("payment_intent")
    if isinstance(intent, dict):
        return intent
    for payment in ((invoice.get("payments") or {}).get("data") or []):
        candidate = (payment.get("payment") or {}).get("payment_intent")
        if isinstance(candidate, dict):
            return candidate
    return None


def verdict(sub):
    """Say why one incomplete subscription never activated. Pure.

    The subscription status is the same whichever way the first invoice failed,
    so the answer is on the PaymentIntent behind it: an unanswered bank challenge
    is a client-side handoff bug with the money still collectable, and a decline
    is a card problem that needs a different card.

    Returns (state, detail).
    """
    status = sub.get("status")
    if status != "incomplete":
        return ("other", "status %r: not waiting on a first payment" % (status,))

    intent = intent_of(sub.get("latest_invoice"))
    if intent is None:
        return ("unexpanded",
                "no PaymentIntent found on the first invoice: expand "
                "latest_invoice.payment_intent, or on 2025-03-31.basil and later "
                "read payments.data.payment.payment_intent")

    pi_status = intent.get("status")

    if pi_status == "requires_action":
        action = (intent.get("next_action") or {}).get("type")
        if not action:
            return ("no-next-action",
                    "the intent wants authentication but nothing was prepared "
                    "for the customer to do, so nobody can finish this one")
        return ("authentication",
                "the issuer asked for a challenge (%s) and it was never shown to "
                "the customer; the payment is still live" % action)

    if pi_status == "requires_payment_method":
        error = intent.get("last_payment_error") or {}
        code = error.get("decline_code") or error.get("code") or "no code recorded"
        return ("declined",
                "the card failed (%s): a decline, not an unanswered challenge, so "
                "this customer needs a different card" % code)

    if pi_status == "requires_confirmation":
        return ("unconfirmed",
                "the intent was created and never confirmed at all: the client "
                "never called confirm, so no bank has seen this payment")

    if pi_status == "processing":
        return ("settling", "the payment is in flight, nothing to do yet")

    return ("other", "payment_intent status %r on an incomplete subscription"
            % (pi_status,))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_subscriptions(session, limit):
    seen = 0
    params = {"status": "incomplete", "limit": 100,
              "expand[]": "data.latest_invoice.payment_intent"}
    while True:
        page = get(session, "/subscriptions", **params)
        rows = page.get("data", [])
        for sub in rows:
            yield sub
            seen += 1
        if not page.get("has_more") or not rows or seen >= limit:
            break
        params["starting_after"] = rows[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-subscriptions", type=int, default=1000,
                    help="stop paginating after this many subscriptions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    states = {}
    scanned = 0
    for sub in page_subscriptions(s, args.max_subscriptions):
        scanned += 1
        state, detail = verdict(sub)
        states[state] = states.get(state, 0) + 1
        if state in ("authentication", "no-next-action", "unexpanded"):
            log.warning("%-15s %s  %s", state, sub.get("id", "?"), detail)
        elif state == "declined":
            log.info("%-15s %s  %s", state, sub.get("id", "?"), detail)

    if not scanned:
        log.info("no incomplete subscriptions")
        return 0

    log.info("%d incomplete subscription(s): %s", scanned,
             ", ".join("%d %s" % (n, k) for k, n in sorted(states.items())))

    if states.get("unexpanded"):
        log.warning("repair: re-run with the expansion that matches your API "
                    "version; an unreadable row is not a healthy one")

    stuck = states.get("authentication", 0) + states.get("no-next-action", 0)
    if not stuck:
        log.info("nothing is waiting on an unanswered authentication")
        return 1 if states.get("unexpanded") else 0

    log.warning("repair: Dashboard, Settings, Billing, Automatic collection: turn "
                "on reminder emails so Stripe sends the Hosted Invoice Page link "
                "when a payment needs authentication")
    log.warning("repair: handle invoice.payment_action_required and pass the "
                "client secret to stripe.handleNextAction in the signup flow")
    log.warning("note: authentication_required is a hard decline, so smart "
                "retries will never clear these on their own")
    return 1


if __name__ == "__main__":
    sys.exit(main())
