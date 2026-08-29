"""Report Stripe bank-debit PaymentIntents stuck in processing past settlement.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to PaymentIntents. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_bank_debit_processing")

API = "https://api.stripe.com/v1"

# Calendar days, generous on purpose: the documented settlement times are in
# business days (ACH about four, SEPA about five), so these carry a weekend.
# One number for every method would flag healthy SEPA while missing stuck ACH,
# which is the whole reason this is a table rather than a constant.
SETTLEMENT_DAYS = {
    "us_bank_account": 6,
    "acss_debit": 6,
    "sepa_debit": 7,
    "bacs_debit": 5,
    "au_becs_debit": 5,
}


def classify(intent, now, grace_days=0):
    """Sort one processing PaymentIntent against its own settlement window.

    Pure, and `now` is passed in rather than read, so a nine-day-old ACH debit
    is a test case rather than a wait.

    `processing` is a legitimate resting state for a bank debit and a fault for
    anything else, so the method decides which rule applies. Where an intent
    lists several debit types, the most generous window wins: reporting normal
    settlement as failure is how a check like this gets switched off.

    Returns (state, detail).
    """
    if intent.get("status") != "processing":
        return ("not_processing", "status %s" % (intent.get("status"),))

    types = [t for t in (intent.get("payment_method_types") or [])
             if t in SETTLEMENT_DAYS]
    age_days = (int(now) - int(intent.get("created") or now)) / 86400.0

    if not types:
        if age_days < 1:
            return ("settling",
                    "processing on a synchronous method, less than a day old")
        return ("non_debit",
                "processing for %.1f day(s) on a method with no multi-day "
                "settlement: the confirmation never completed" % age_days)

    window = max(SETTLEMENT_DAYS[t] for t in types) + grace_days
    method = max(types, key=lambda t: SETTLEMENT_DAYS[t])

    if age_days <= window:
        return ("settling",
                "day %.1f of a %d day window for %s" % (age_days, window, method))
    if age_days > 30:
        return ("long_stuck",
                "%.1f day(s) in processing on %s: far past settlement, and past "
                "the window in which cancelling is still permitted" % (age_days, method))
    return ("stuck",
            "%.1f day(s) in processing on %s, window is %d: this is not "
            "settlement taking its time" % (age_days, method, window))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def intents(session, since, cap):
    """Yield PaymentIntents, paginating until Stripe stops or the cap is hit."""
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/payment_intents", **params)
        data = page.get("data", [])
        for pi in data:
            yield pi
            seen += 1
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to read intents")
    ap.add_argument("--grace-days", type=int, default=0,
                    help="add this many days to every settlement window")
    ap.add_argument("--max-intents", type=int, default=20000,
                    help="stop paginating after this many intents")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = int(time.time())
    counts, amounts = {}, {}
    processing = 0

    for pi in intents(s, now - args.days * 86400, args.max_intents):
        state, detail = classify(pi, now, args.grace_days)
        if state == "not_processing":
            continue
        processing += 1
        counts[state] = counts.get(state, 0) + 1
        amounts[state] = amounts.get(state, 0) + (pi.get("amount") or 0)
        if state != "settling":
            log.warning("%s  %-11s %s", pi.get("id", "pi_?"), state, detail)

    stuck = counts.get("stuck", 0)
    long_stuck = counts.get("long_stuck", 0)

    log.info("%d processing intent(s): %d settling, %d stuck, %d long-stuck, "
             "%d non-debit", processing, counts.get("settling", 0), stuck,
             long_stuck, counts.get("non_debit", 0))

    if stuck or long_stuck:
        log.warning("  %d minor unit(s) sitting in processing past settlement",
                    amounts.get("stuck", 0) + amounts.get("long_stuck", 0))
        log.warning("  repair: subscribe an endpoint to payment_intent.succeeded, "
                    "payment_intent.processing and payment_intent.payment_failed, "
                    "and gate fulfilment on succeeded only:")
        log.warning("  POST %s/webhook_endpoints -d url=... "
                    "-d enabled_events[]=payment_intent.succeeded", API)
    if long_stuck:
        log.warning("  %d intent(s) are past the point where cancelling is "
                    "permitted. Reconcile those against GET %s/charges.",
                    long_stuck, API)
    if counts.get("non_debit"):
        log.warning("  %d intent(s) are processing on a method with no "
                    "multi-day settlement: those are a confirmation that never "
                    "finished, not a slow bank.", counts["non_debit"])
    return 1 if (stuck or long_stuck or counts.get("non_debit")) else 0


if __name__ == "__main__":
    sys.exit(main())
