"""Report Stripe PaymentMethods that were never attached to a Customer.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
PaymentMethods and PaymentIntents. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_orphaned_payment_methods")

API = "https://api.stripe.com/v1"

MIN_AGE_HOURS = 24    # younger than this is a checkout still in progress
WARN_RATIO = 0.25     # a quarter of cards discarded is a code path, not residue
HIGH_RATIO = 0.50


def verdict(orphans, attached, unsaved_intents, reuse_errors):
    """Classify the orphan population. Pure, so the ratios can be tested offline.

    orphans        unattached card PaymentMethods older than MIN_AGE_HOURS
    attached       card PaymentMethods with a customer set
    unsaved_intents PaymentIntents with a customer but no setup_future_usage
    reuse_errors   PaymentIntents that failed with payment_method_unexpected_state

    Returns (state, detail).
    """
    total = orphans + attached
    if reuse_errors:
        return ("burned",
                "%d PaymentIntent(s) failed with payment_method_unexpected_state: "
                "a consumed pm_ is already being charged a second time. %d orphan(s) "
                "on the account." % (reuse_errors, orphans))
    if not total:
        return ("clear",
                "no card PaymentMethods older than %d hours to judge" % MIN_AGE_HOURS)
    ratio = orphans / float(total)
    if ratio >= HIGH_RATIO:
        return ("leaking",
                "%d of %d card PaymentMethods (%.0f%%) were never attached. This is "
                "the current behaviour of the checkout, not old residue."
                % (orphans, total, ratio * 100))
    if unsaved_intents:
        return ("unsaved",
                "%d PaymentIntent(s) charged a known customer with setup_future_usage "
                "unset, so those cards were discarded after one use. %d orphan(s) so "
                "far." % (unsaved_intents, orphans))
    if ratio >= WARN_RATIO:
        return ("orphaned",
                "%d of %d card PaymentMethods (%.0f%%) have no customer. Reusing any "
                "of them will fail." % (orphans, total, ratio * 100))
    if orphans:
        return ("residue",
                "%d of %d card PaymentMethods have no customer. Small enough to be "
                "history rather than the live path." % (orphans, total))
    return ("clear", "every card PaymentMethod in the window is attached to a customer")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    """Yield objects from a paginated list endpoint until `limit` is reached."""
    seen = 0
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-objects", type=int, default=2000,
                    help="stop paginating each list after this many objects")
    ap.add_argument("--min-age-hours", type=float, default=MIN_AGE_HOURS,
                    help="ignore unattached PaymentMethods younger than this")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    cutoff = time.time() - args.min_age_hours * 3600.0
    orphans = attached = 0
    sample = []
    for pm in page_all(s, "/payment_methods", args.max_objects, type="card", limit=100):
        if pm.get("customer"):
            attached += 1
        elif (pm.get("created") or 0) < cutoff:
            orphans += 1
            if len(sample) < 5:
                sample.append(pm.get("id"))

    unsaved = reuse_errors = 0
    for pi in page_all(s, "/payment_intents", args.max_objects, limit=100):
        if pi.get("customer") and not pi.get("setup_future_usage"):
            unsaved += 1
        err = pi.get("last_payment_error") or {}
        if err.get("code") == "payment_method_unexpected_state":
            reuse_errors += 1

    state, detail = verdict(orphans, attached, unsaved, reuse_errors)
    line = "%-9s %s" % (state, detail)
    if state == "clear":
        log.info(line)
        return 0

    log.warning(line)
    for pm_id in sample:
        log.warning("  orphan %s", pm_id)
    log.warning("  save the card as part of the payment rather than storing the id:")
    log.warning("  POST %s/payment_intents -d customer=cus_X "
                "-d setup_future_usage=off_session", API)
    log.warning("  to store a card without charging it:")
    log.warning("  POST %s/setup_intents -d customer=cus_X -d usage=off_session", API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
