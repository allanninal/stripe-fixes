"""Report the share of Stripe Checkout Sessions that expire unpaid.

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
log = logging.getLogger("stripe_checkout_abandonment")

API = "https://api.stripe.com/v1"

HIGH_SHARE = 0.5    # more than half of everything created is thrown away
WATCH_SHARE = 0.25  # worth looking at before it becomes the first number


def verdict(total, expired, lapsed_open=0):
    """Classify one window of Checkout Sessions. Pure, so the thresholds are testable.

    `total` is every session created in the window, `expired` the ones Stripe has
    already marked expired, and `lapsed_open` the ones still marked open whose
    expires_at is in the past. Returns (state, detail).
    """
    if not total:
        return ("no-data", "no Checkout Sessions were created in the window")
    share = expired / float(total)
    pct = 100.0 * share
    if share >= HIGH_SHARE:
        return ("abandoned",
                "%d of %d session(s) expired unpaid (%.1f%%). More than half of "
                "everything created is being discarded." % (expired, total, pct))
    if lapsed_open:
        return ("lapsed",
                "%d open session(s) are already past expires_at and have not been "
                "marked yet; %.1f%% expired so far." % (lapsed_open, pct))
    if share >= WATCH_SHARE:
        return ("elevated",
                "%d of %d session(s) expired unpaid (%.1f%%). Shorten the window "
                "so the lapse is visible in hours." % (expired, total, pct))
    return ("normal",
            "%d of %d session(s) expired unpaid (%.1f%%)." % (expired, total, pct))


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def scan(session, since, cap):
    """Tally status across every session created since `since`.

    Stripe returns newest first; the order does not matter for a tally, but the
    pagination does, because a single page of 100 on a busy account is a sample
    rather than a rate.
    """
    counts = {"open": 0, "complete": 0, "expired": 0}
    total = 0
    lapsed = 0
    now = int(time.time())
    params = {"created[gte]": since, "limit": 100}
    while True:
        page = get(session, "/checkout/sessions", params)
        data = page.get("data", [])
        for cs in data:
            total += 1
            state = cs.get("status") or "unknown"
            counts[state] = counts.get(state, 0) + 1
            expires = cs.get("expires_at")
            if state == "open" and expires is not None and expires < now:
                lapsed += 1
        if not data or not page.get("has_more") or total >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return total, counts, lapsed


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="window to measure, in days (keep it fixed between runs)")
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
    total, counts, lapsed = scan(s, since, args.max_sessions)
    state, detail = verdict(total, counts.get("expired", 0), lapsed)

    log.info("%-11s %s", state, detail)
    log.info("  open %d  complete %d  expired %d  (last %d days)",
             counts.get("open", 0), counts.get("complete", 0),
             counts.get("expired", 0), args.days)
    if state in ("normal", "no-data"):
        return 0

    log.warning("  repair: create sessions with a shorter window so a lapse shows "
                "up in hours rather than a day:")
    log.warning("  POST %s/checkout/sessions -d expires_at=<now+7200>   "
                "(min 30 minutes, max 24 hours)", API)
    log.warning("  and subscribe an event destination to checkout.session.expired "
                "so each lapse is recorded")
    return 1


if __name__ == "__main__":
    sys.exit(main())
