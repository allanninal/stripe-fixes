"""Report whether a live Stripe key is actually transacting in live mode.

Read only. Four GET requests, no writes: give this a RESTRICTED key with read
access to Account, Charges, PaymentIntents and Customers. The repair is printed,
never performed, because this script holds a credential to a live payments
account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_live_mode_check")

API = "https://api.stripe.com/v1"
TESTMODE = "testmode_decline"


def count_testmode_declines(charges, intents):
    """Count objects that failed because a test artefact reached live mode.

    Pure, so the rules can be tested without a network. Stripe records this one
    condition in three different fields depending on how far the payment got: a
    charge carries it as `failure_code` and again as `outcome.reason`, while a
    PaymentIntent that never produced a charge carries it as
    `last_payment_error.code`. Reading only one of them under-counts.
    """
    n = 0
    for c in charges:
        outcome = c.get("outcome") or {}
        if c.get("failure_code") == TESTMODE or outcome.get("reason") == TESTMODE:
            n += 1
    for pi in intents:
        err = pi.get("last_payment_error") or {}
        if err.get("code") == TESTMODE:
            n += 1
    return n


def verdict(key_mode, account, counts):
    """Classify one account. Pure.

    key_mode is "live" or "test", taken from the key prefix. counts holds how
    many objects of each kind this key could see, plus the decline tally.
    """
    if key_mode != "live":
        return ("test_key",
                "this is a test-mode key, so it cannot see the live account at "
                "all: run it again with a restricted live key")
    if not account.get("details_submitted") or not account.get("charges_enabled"):
        return ("not_activated",
                "activation is unfinished, so the account is limited to "
                "test-mode charges: charges_enabled=%s details_submitted=%s"
                % (account.get("charges_enabled"), account.get("details_submitted")))
    if counts.get("testmode_declines"):
        return ("test_cards_live",
                "%d live payment(s) failed with testmode_decline: a test card "
                "number or a test-mode object id reached production"
                % counts["testmode_declines"])
    if not any(counts.get(k, 0) for k in ("charges", "payment_intents", "customers")):
        return ("pointed_at_test",
                "the live account holds no charges, intents or customers: the "
                "application is transacting in test mode")
    return ("healthy", "live objects exist and no testmode_decline in the window")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to " + path)
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=100,
                    help="objects to read per resource (1-100)")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    mode = "live" if "_live_" in key else "test"
    account = get(s, "/account")
    charges = get(s, "/charges", limit=args.limit).get("data", [])
    intents = get(s, "/payment_intents", limit=args.limit).get("data", [])
    customers = get(s, "/customers", limit=args.limit).get("data", [])

    counts = {
        "charges": len(charges),
        "payment_intents": len(intents),
        "customers": len(customers),
        "testmode_declines": count_testmode_declines(charges, intents),
    }

    state, detail = verdict(mode, account, counts)
    line = "%-16s %s" % (state, detail)
    if state == "healthy":
        log.info(line)
        return 0

    log.warning(line)
    if state == "test_key":
        log.warning("  repair: export a restricted key beginning rk_live_ and re-run")
        return 2
    if state == "not_activated":
        log.warning("  repair: finish activation at "
                    "https://dashboard.stripe.com/account/onboarding until "
                    "charges_enabled is true")
    else:
        log.warning("  repair: put a matching sk_live_ and pk_live_ pair from the "
                    "same account on server and client")
        log.warning("  repair: remove hardcoded test-mode ids; resolve prices by "
                    "lookup_key so one code path works in both modes")
    log.info("read %d charge(s), %d intent(s), %d customer(s) in %s mode",
             counts["charges"], counts["payment_intents"], counts["customers"], mode)
    return 1


if __name__ == "__main__":
    sys.exit(main())
