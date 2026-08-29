"""Report Stripe Checkout Sessions that completed without a Customer.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Checkout Sessions. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_checkout_guests")

API = "https://api.stripe.com/v1"


def verdict(session, email_seen=1):
    """Classify one completed Checkout Session. Pure, so the rules can be tested
    offline.

    `email_seen` is how many sessions in the window share this session's
    customer_details.email. A single Session cannot tell you whether its buyer
    has been here before, and that is the fact the whole report turns on.
    Returns (state, detail).
    """
    if session.get("customer"):
        return ("linked", "customer=%s" % (session["customer"],))

    mode = session.get("mode")
    if mode != "payment":
        return ("unknown",
                "mode %r completed with no Customer, which Stripe normally "
                "requires here" % (mode,))

    creation = session.get("customer_creation")
    if creation == "always":
        return ("unknown",
                "customer_creation=always but no Customer is attached; check the "
                "session really completed")

    email = str((session.get("customer_details") or {}).get("email") or "").strip()
    if not email:
        return ("anonymous",
                "no Customer and no customer_details.email: nothing at all to "
                "match this payment to later")
    if email_seen > 1:
        return ("repeat-guest",
                "%s completed %d sessions in this window and was a new stranger "
                "every time" % (email, email_seen))
    return ("guest",
            "customer_creation=%r, so Stripe made no Customer; %s exists only as "
            "a string on the Session" % (creation, email))


def email_of(session):
    """The address a guest session could later be matched on, normalised."""
    return str((session.get("customer_details") or {}).get("email") or "").strip().lower()


def email_counts(sessions):
    """Count how many sessions share each address. Pure, and used before any
    session is classified, because the count is an argument to the classifier."""
    counts = {}
    for s in sessions:
        addr = email_of(s)
        if addr:
            counts[addr] = counts.get(addr, 0) + 1
    return counts


def get(http, path, params=None):
    r = http.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def completed_sessions(http, since, limit):
    """Yield completed Checkout Sessions created since `since`, newest first."""
    seen = 0
    params = {"limit": 100, "status": "complete", "created[gte]": int(since)}
    while True:
        page = get(http, "/checkout/sessions", params)
        data = page.get("data", [])
        for s in data:
            yield s
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to read completed sessions")
    ap.add_argument("--max-sessions", type=int, default=5000,
                    help="stop paginating after this many sessions")
    ap.add_argument("--show", type=int, default=10,
                    help="how many repeat guests to print")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    http = requests.Session()
    http.headers.update({"Authorization": "Bearer " + key})

    since = time.time() - args.days * 86400
    sessions = list(completed_sessions(http, since, args.max_sessions))
    if not sessions:
        log.info("no completed Checkout Sessions in the last %d days", args.days)
        return 0

    counts = email_counts(sessions)
    tally = {"linked": 0, "guest": 0, "repeat-guest": 0, "anonymous": 0, "unknown": 0}
    repeats = []
    for s in sessions:
        state, detail = verdict(s, counts.get(email_of(s), 1))
        tally[state] = tally.get(state, 0) + 1
        if state == "repeat-guest" and len(repeats) < args.show:
            repeats.append((s.get("id", "?"), detail))

    log.info("%d session(s): %d linked, %d guest, %d repeat-guest, %d anonymous",
             len(sessions), tally["linked"], tally["guest"],
             tally["repeat-guest"], tally["anonymous"])
    for sid, detail in repeats:
        log.warning("repeat-guest  %s  %s", sid, detail)
    if tally["unknown"]:
        log.warning("%d session(s) in an unexpected state; read them by hand",
                    tally["unknown"])

    unlinked = tally["guest"] + tally["repeat-guest"] + tally["anonymous"]
    if unlinked:
        log.warning("  repair: POST %s/checkout/sessions -d customer_creation=always",
                    API)
        log.warning("          or pass the id you already hold: -d customer=cus_XXX")
        log.warning("  for a Payment Link, set it on the link: POST "
                    "%s/payment_links/plink_XXX -d customer_creation=always", API)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
