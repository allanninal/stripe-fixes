"""Report Stripe charges created without a PaymentIntent, and what it costs.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Charges. The repair is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_legacy_charges")

API = "https://api.stripe.com/v1"


def classify(charge):
    """Sort one charge by the API that created it and by what the issuer did.

    Pure, so the rules can be tested without a network.

    A charge created through a PaymentIntent carries that intent's id, whatever
    made it: Checkout, an invoice, a subscription renewal, a direct confirm. A
    null or absent `payment_intent` therefore is not a proxy for the legacy
    Charges API, it is the legacy Charges API.

    Returns (state, detail).
    """
    if charge.get("payment_intent"):
        return ("modern", "created through a PaymentIntent")

    status = charge.get("status")
    outcome = charge.get("outcome") or {}
    reason = outcome.get("reason")

    if status == "succeeded":
        return ("legacy",
                "succeeded on the legacy Charges API: no 3D Secure was possible "
                "on this payment, and none was attempted")

    if reason == "authentication_required":
        return ("unauthenticated",
                "declined for authentication_required: the Charges API cannot "
                "run 3D Secure, so retrying the same source declines again")

    if status == "failed":
        return ("legacy_declined",
                "legacy charge declined (%s): this one would likely have failed "
                "on the modern path too" % (reason or "no outcome.reason"))

    if status == "pending":
        return ("legacy_pending",
                "legacy charge still pending: an asynchronous method on an API "
                "with no intent to track it")

    return ("unknown", "unrecognised charge status: %r" % (status,))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def charges(session, since, cap):
    """Yield charges newest first, paginating until Stripe stops or the cap is hit."""
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/charges", **params)
        data = page.get("data", [])
        for ch in data:
            yield ch
            seen += 1
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to read charges")
    ap.add_argument("--max-charges", type=int, default=20000,
                    help="stop paginating after this many charges")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    counts, amounts = {}, {}
    scanned = 0
    for ch in charges(s, since, args.max_charges):
        scanned += 1
        state, detail = classify(ch)
        counts[state] = counts.get(state, 0) + 1
        amounts[state] = amounts.get(state, 0) + (ch.get("amount") or 0)
        if state in ("unauthenticated", "unknown"):
            log.warning("%s  %-15s %s", ch.get("id", "ch_?"), state, detail)

    legacy_states = ("legacy", "unauthenticated", "legacy_declined", "legacy_pending")
    legacy = sum(counts.get(k, 0) for k in legacy_states)
    blocked = counts.get("unauthenticated", 0)

    log.info("%d charge(s): %d modern, %d legacy, %d declined for authentication",
             scanned, counts.get("modern", 0), legacy, blocked)

    if legacy and scanned:
        log.warning("  %.1f%% of charges have no PaymentIntent, %d minor unit(s) "
                    "of volume on an API that cannot authenticate",
                    100.0 * legacy / scanned,
                    sum(amounts.get(k, 0) for k in legacy_states))
    if blocked:
        log.warning("  %d of those were declined for authentication_required. "
                    "A retry on the same source declines again.", blocked)
    if legacy:
        log.warning("  repair: replace POST %s/charges -d source=tok_... with", API)
        log.warning("  POST %s/payment_intents -d amount=... -d currency=... "
                    "-d customer=cus_... -d payment_method=pm_... -d confirm=true", API)
        log.warning("  and handle requires_action on the client. Convert stored "
                    "card_ sources to PaymentMethods before cutting over.")
    return 1 if legacy else 0


if __name__ == "__main__":
    sys.exit(main())
