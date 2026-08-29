"""Report Stripe Payment Links that are deactivated but still receiving traffic.

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
log = logging.getLogger("stripe_inactive_payment_links")

API = "https://api.stripe.com/v1"


def verdict(active, recent_sessions, inactive_message=None):
    """Classify one Payment Link. Pure, so the rules can be tested without a network.

    `active` is the link's flag, `recent_sessions` the number of Checkout Sessions
    it created inside the window, and `inactive_message` the custom text shown on
    the deactivation page. Returns (state, detail).
    """
    if active is None:
        return ("unknown",
                "the link has no active flag; treat it as published until you know "
                "otherwise (%d recent session(s))" % recent_sessions)
    if active:
        return ("live", "%d session(s) in the window" % recent_sessions)
    if recent_sessions:
        if inactive_message:
            return ("dead-signposted",
                    "inactive, %d recent session(s), and customers at least see: %r"
                    % (recent_sessions, inactive_message))
        return ("dead-in-use",
                "inactive but still reached %d time(s) in the window: every one of "
                "those landed on Stripe's deactivation page" % recent_sessions)
    return ("dormant", "inactive and nothing has reached it in the window")


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def payment_links(session, cap):
    """Every Payment Link on the account, active and not."""
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
    """Sessions this link created since `since`.

    Only the count matters, but the pagination still has to happen: a busy link
    can fill a page with sessions from a single afternoon.
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
    ap.add_argument("--days", type=int, default=90,
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
        count = recent_session_count(s, link["id"], since)
        state, detail = verdict(link.get("active"), count, link.get("inactive_message"))
        line = "%-15s %-20s %s" % (state, link["id"], detail)
        if state in ("live", "dormant"):
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        log.warning("  published at: %s", link.get("url") or "<no url>")
        log.warning("  repair: repoint the published URL at a live link, or bring "
                    "this one back:")
        log.warning("  POST %s/payment_links/%s -d active=true", API, link["id"])
        if not link.get("inactive_message"):
            log.warning("  if it stays dead, give the deactivation page a "
                        "forwarding instruction with -d inactive_message=\"...\"")

    log.info("%d inactive link(s) still taking traffic", bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
