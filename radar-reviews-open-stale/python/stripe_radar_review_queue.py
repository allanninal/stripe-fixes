"""Report Stripe Radar reviews left open while the funds behind them are at risk.

Read only. Paginated GETs and nothing else: give this a RESTRICTED key with read
access to Reviews and Charges. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_radar_review_queue")

API = "https://api.stripe.com/v1"

STALE_DAYS = 3     # past this the queue is a backlog, not a queue
LAPSE_DAYS = 7     # an uncaptured authorization is released at this age
MIN_CLOSED = 20    # below this the approval rate is noise
OVERBROAD = 0.95   # approvals at or above this: the rule never changes an outcome
WIDE = 0.80


def verdict(age_days, captured):
    """Classify one open review. Pure, so both deadlines can be tested offline.

    `captured` is the `captured` flag of the review's charge, or None when the
    charge could not be read. Returns (state, detail).
    """
    if age_days < STALE_DAYS:
        return ("open",
                "open for %.1f day(s), still inside the window Stripe asks you to "
                "work" % age_days)
    if captured is False and age_days >= LAPSE_DAYS:
        return ("lapsed",
                "open for %.1f day(s) on an uncaptured authorization: the hold was "
                "released at %d days and approving it now captures nothing"
                % (age_days, LAPSE_DAYS))
    if captured is False:
        return ("expiring",
                "open for %.1f day(s) on an uncaptured authorization, released in "
                "%.1f day(s)" % (age_days, LAPSE_DAYS - age_days))
    if age_days >= LAPSE_DAYS:
        return ("critical",
                "open for %.1f day(s) on a captured charge: the money is with you "
                "and the dispute window is already running" % age_days)
    return ("stale", "open for %.1f day(s) on a captured charge" % age_days)


def rule_health(approved, closed):
    """Judge the review rule from how its reviews were closed. Pure.

    `approved` counts closed_reason == "approved"; `closed` counts every review
    with any closed_reason. Returns (state, detail).
    """
    if closed < MIN_CLOSED:
        return ("insufficient",
                "%d closed review(s) is too few to judge the rule" % closed)
    rate = approved / float(closed)
    if rate >= OVERBROAD:
        return ("overbroad",
                "%.0f%% of closed reviews were approved: the rule flags traffic you "
                "always accept and has never changed an outcome" % (rate * 100))
    if rate >= WIDE:
        return ("wide",
                "%.0f%% approved: add a second predicate before staffing this queue"
                % (rate * 100))
    return ("earning", "%.0f%% approved: the rule is catching real fraud"
            % (rate * 100))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page(session, path, cap, **params):
    """Collect up to `cap` objects from a list endpoint."""
    out = []
    params = dict(params)
    params["limit"] = 100
    while True:
        p = get(session, path, **params)
        data = p.get("data", [])
        out.extend(data)
        if not data or not p.get("has_more") or len(out) >= cap:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def captured_flag(session, charge_id, cache):
    """Read `captured` off the charge behind a review. None when unreadable."""
    if not charge_id:
        return None
    if charge_id not in cache:
        try:
            cache[charge_id] = get(session, "/charges/" + charge_id).get("captured")
        except requests.HTTPError:
            cache[charge_id] = None
    return cache[charge_id]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="window for the approval-rate audit")
    ap.add_argument("--max-reviews", type=int, default=2000,
                    help="stop paginating after this many reviews")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    since = now - args.days * 86400
    reviews = page(s, "/reviews", args.max_reviews)

    cache = {}
    approved = closed = flagged = 0
    by_reason = {}
    for rev in reviews:
        created = rev.get("created", now)
        if created >= since and rev.get("closed_reason"):
            closed += 1
            if rev["closed_reason"] == "approved":
                approved += 1
        if not rev.get("open"):
            continue
        reason = rev.get("opened_reason") or "unknown"
        by_reason[reason] = by_reason.get(reason, 0) + 1
        age = (now - created) / 86400.0
        state, detail = verdict(age, captured_flag(s, rev.get("charge"), cache))
        if state == "open":
            log.info("%-9s %s  %s", state, rev.get("id"), detail)
            continue
        flagged += 1
        log.warning("%-9s %s  %s", state, rev.get("id"), detail)
        log.warning("    opened by %s, charge %s", reason, rev.get("charge"))

    for reason, n in sorted(by_reason.items()):
        log.info("%d open review(s) opened by %s", n, reason)
    health, detail = rule_health(approved, closed)
    log.info("%-12s %s", health, detail)

    if not flagged and health not in ("overbroad", "wide"):
        log.info("0 open review(s) past %d days", STALE_DAYS)
        return 0

    if flagged:
        log.warning("  work the queue: Dashboard, Radar, Reviews, then Approve, "
                    "Refund, or Refund and report fraud on each one")
        log.warning("  alert instead of polling: subscribe an endpoint to "
                    "review.opened")
    if health in ("overbroad", "wide"):
        log.warning("  narrow the rule in Dashboard, Radar, Rules: add a second "
                    "predicate, for example is_disposable_email alongside the "
                    "card_funding test, or delete the rule outright")
    return 1


if __name__ == "__main__":
    sys.exit(main())
