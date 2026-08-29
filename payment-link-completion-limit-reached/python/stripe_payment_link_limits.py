"""Report Stripe Payment Links that have reached their completed-session limit.

Read only. Two GETs and no writes: give this a RESTRICTED key with read access to
Payment Links and Checkout Sessions. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_payment_link_limits")

API = "https://api.stripe.com/v1"

NEAR = 0.9  # far enough along the cap that it will be met before anyone looks again


def verdict(restrictions, recent_sessions=0):
    """Classify one Payment Link's completion cap. Pure, so it is testable offline.

    `restrictions` is the link's restrictions object, which is None on most links.
    `recent_sessions` is the number of Checkout Sessions it created in the window,
    which separates a dead link nobody visits from one that is turning people away.
    Returns (state, detail).
    """
    completed = ((restrictions or {}).get("completed_sessions") or {})
    limit = completed.get("limit")
    count = completed.get("count")
    if limit is None:
        return ("uncapped", "no completion limit set")
    if count is None:
        return ("unknown",
                "capped at %s and the counter is missing from the response; treat "
                "it as unread rather than as zero" % limit)
    if count >= limit:
        if recent_sessions:
            return ("exhausted-in-use",
                    "%d of %d completed session(s): the cap is met and %d "
                    "customer(s) have still arrived since"
                    % (count, limit, recent_sessions))
        return ("exhausted",
                "%d of %d completed session(s): the cap is met and the link no "
                "longer accepts completions" % (count, limit))
    if limit and count / float(limit) >= NEAR:
        return ("near-limit",
                "%d of %d completed session(s): this link closes itself within "
                "days at the current rate" % (count, limit))
    return ("headroom", "%d of %d completed session(s)" % (count, limit))


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def payment_links(session, cap):
    """Every Payment Link on the account, capped and not."""
    out = []
    params = {"limit": 100}
    while True:
        page = get(session, "/payment_links", params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def recent_session_count(session, link_id, since):
    """Sessions this link created since `since`, whatever their status.

    An exhausted link still creates sessions; they just cannot complete. Counting
    them is how you find out whether the published URL is still in circulation.
    """
    count = 0
    params = {"payment_link": link_id, "limit": 100}
    while True:
        page = get(session, "/checkout/sessions", params)
        data = page.get("data", [])
        for cs in data:
            if (cs.get("created") or 0) >= since:
                count += 1
        if not data or not page.get("has_more"):
            break
        if (data[-1].get("created") or 0) < since:
            break
        params["starting_after"] = data[-1]["id"]
    return count


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back a session still counts as recent traffic")
    ap.add_argument("--max-links", type=int, default=500,
                    help="stop paginating after this many Payment Links")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    bad = 0
    for link in payment_links(s, args.max_links):
        restrictions = link.get("restrictions")
        # Only capped links are worth a second request, and most links are not.
        recent = 0
        if restrictions:
            recent = recent_session_count(s, link["id"], since)
        state, detail = verdict(restrictions, recent)
        line = "%-17s %-20s %s" % (state, link["id"], detail)
        if state in ("uncapped", "headroom"):
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        log.warning("  published at: %s", link.get("url") or "<no url>")
        log.warning("  repair: raise the cap and keep the same URL:")
        log.warning("  POST %s/payment_links/%s -d "
                    "\"restrictions[completed_sessions][limit]=<higher>\"",
                    API, link["id"])
        log.warning("  or create a fresh link for the next tranche and swap the "
                    "published URL everywhere it appears")

    log.info("%d capped link(s) at or near their completion limit", bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
