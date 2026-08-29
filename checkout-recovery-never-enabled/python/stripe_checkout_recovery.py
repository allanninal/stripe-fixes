"""Report expired Stripe Checkout Sessions that can never be recovered by email.

Read only. Two paginated GETs and no writes: give this a RESTRICTED key with read
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
log = logging.getLogger("stripe_checkout_recovery")

API = "https://api.stripe.com/v1"


def verdict(session, now):
    """Classify one expired Checkout Session. Pure, so the rules can be tested
    offline.

    `now` is unix seconds, passed in rather than read, so the recovery URL's own
    expiry boundary can be pinned in a test.
    Returns (state, detail).
    """
    recovery = (session.get("after_expiration") or {}).get("recovery") or {}
    if not recovery.get("enabled"):
        return ("no-recovery",
                "after_expiration[recovery][enabled] was not set at creation, so "
                "this lapse has no recovery url and never will")

    url = str(recovery.get("url") or "").strip()
    if not url:
        return ("unknown",
                "recovery is enabled but no url is present on an expired session")

    expires_at = recovery.get("expires_at")
    if expires_at is not None and expires_at <= now:
        return ("lapsed",
                "the recovery url expired %.1f day(s) ago; mailing it now sends "
                "the customer to a dead link" % ((now - expires_at) / 86400.0))

    left = ((expires_at - now) / 86400.0) if expires_at is not None else float("nan")
    consent = (session.get("consent") or {}).get("promotions")
    if consent != "opt_in":
        return ("no-consent",
                "the recovery url is live for %.1f more day(s), but "
                "consent.promotions is %r: there is no recorded permission to "
                "mail this address" % (left, consent))

    return ("recoverable",
            "the recovery url is live for %.1f more day(s) and the customer "
            "opted in" % (left,))


def get(http, path, params=None):
    r = http.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def sessions_with_status(http, status, since, limit):
    """Yield Checkout Sessions with `status` created since `since`, newest first."""
    seen = 0
    params = {"limit": 100, "status": status, "created[gte]": int(since)}
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
    ap.add_argument("--days", type=int, default=60,
                    help="how far back to read sessions")
    ap.add_argument("--max-sessions", type=int, default=5000,
                    help="stop paginating after this many sessions per status")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    http = requests.Session()
    http.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    since = now - args.days * 86400

    tally = {"no-recovery": 0, "lapsed": 0, "no-consent": 0,
             "recoverable": 0, "unknown": 0}
    expired = 0
    for s in sessions_with_status(http, "expired", since, args.max_sessions):
        expired += 1
        state, _ = verdict(s, now)
        tally[state] = tally.get(state, 0) + 1

    recovered = 0
    completed = 0
    for s in sessions_with_status(http, "complete", since, args.max_sessions):
        completed += 1
        if s.get("recovered_from"):
            recovered += 1

    log.info("%d expired: %d no-recovery, %d lapsed, %d no-consent, %d recoverable",
             expired, tally["no-recovery"], tally["lapsed"], tally["no-consent"],
             tally["recoverable"])
    log.info("%d completed session(s), %d carrying recovered_from",
             completed, recovered)

    if tally["no-recovery"]:
        log.warning("  repair: POST %s/checkout/sessions "
                    "-d 'after_expiration[recovery][enabled]=true' "
                    "-d 'consent_collection[promotions]=auto'", API)
    if tally["no-consent"]:
        log.warning("  recovery urls exist but consent.promotions is not opt_in; "
                    "add -d 'consent_collection[promotions]=auto' at creation")
    if tally["lapsed"]:
        log.warning("  recovery urls went past after_expiration.recovery.expires_at "
                    "before anything sent them; check expires_at at send time")
    if expired and not recovered:
        log.warning("  no completed session carries recovered_from: nothing has "
                    "ever come back through a recovery url")
        log.warning("  subscribe checkout.session.expired and mail "
                    "after_expiration.recovery.url to customer_details.email")

    return 1 if (tally["no-recovery"] or tally["lapsed"] or tally["no-consent"]) else 0


if __name__ == "__main__":
    sys.exit(main())
