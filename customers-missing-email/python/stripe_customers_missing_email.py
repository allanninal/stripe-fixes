"""Report Stripe customers with no email, so no receipt or dunning notice is sent.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Customers, Subscriptions and Charges. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_customers_missing_email")

API = "https://api.stripe.com/v1"

WIDESPREAD_RATIO = 0.25   # a quarter of customers is a signup path, not a backlog


def verdict(missing, total, with_active_sub, receiptless_charges, disputed):
    """Classify the email gap. Pure, so the ordering can be tested offline.

    missing              customers with a null or empty email
    total                customers examined
    with_active_sub      of those, how many have an active subscription
    receiptless_charges  charges with neither a customer nor a receipt_email
    disputed             charges from emailless customers already disputed

    Returns (state, detail). The order is deliberate: money already lost outranks
    money about to be lost, which outranks a percentage.
    """
    if disputed:
        return ("disputed",
                "%d charge(s) from customers with no email have been disputed. The "
                "cardholder had no receipt to recognise the descriptor by."
                % disputed)
    if with_active_sub:
        return ("unreachable",
                "%d customer(s) with an active subscription have no email. When the "
                "renewal fails, dunning has nowhere to send anything."
                % with_active_sub)
    if not total:
        return ("clear", "no customers in the window")
    ratio = missing / float(total)
    if ratio >= WIDESPREAD_RATIO:
        return ("widespread",
                "%d of %d customers (%.0f%%) have no email. That is the signup path "
                "behaving this way now, not an old backlog."
                % (missing, total, ratio * 100))
    if missing:
        return ("gaps",
                "%d of %d customers have no email and will receive no receipt"
                % (missing, total))
    if receiptless_charges:
        return ("receiptless",
                "every customer has an email, but %d charge(s) had neither a "
                "customer nor a receipt_email: guest checkout sends no receipt"
                % receiptless_charges)
    return ("clear", "every customer in the window has an email")


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
    ap.add_argument("--max-customers", type=int, default=2000,
                    help="stop paginating customers after this many")
    ap.add_argument("--max-charges", type=int, default=2000,
                    help="stop paginating charges after this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    total = missing = with_active_sub = 0
    emailless = set()
    sample = []
    for cust in page_all(s, "/customers", args.max_customers, limit=100):
        total += 1
        # Both null and "" occur; a form that posts a blank field produces the
        # second, and a check for None alone walks straight past it.
        if (cust.get("email") or "").strip():
            continue
        missing += 1
        cid = cust.get("id")
        emailless.add(cid)
        if len(sample) < 5:
            sample.append(cid)
        subs = get(s, "/subscriptions", customer=cid, status="active", limit=1)
        if subs.get("data"):
            with_active_sub += 1

    receiptless = disputed = 0
    for ch in page_all(s, "/charges", args.max_charges, limit=100):
        if not ch.get("customer") and not ch.get("receipt_email"):
            receiptless += 1
        if ch.get("disputed") and ch.get("customer") in emailless:
            disputed += 1

    state, detail = verdict(missing, total, with_active_sub, receiptless, disputed)
    line = "%-11s %s" % (state, detail)
    if state == "clear":
        log.info(line)
        return 0

    log.warning(line)
    for cid in sample:
        log.warning("  no email  %s", cid)
    log.warning("  backfill from your own user table:")
    log.warning("  POST %s/customers/{id} -d email=user@example.com "
                "-d name=\"Jenny Rosen\"", API)
    if receiptless:
        log.warning("  and for guest payments, set the address on the intent:")
        log.warning("  POST %s/payment_intents -d receipt_email=user@example.com", API)
    log.warning("  then confirm receipts are enabled at "
                "https://dashboard.stripe.com/settings/emails")
    return 1


if __name__ == "__main__":
    sys.exit(main())
