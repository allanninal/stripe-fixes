"""Report active subscriptions already scheduled to cancel, as a rate and a date.

Read only. One GET, no writes: give this a RESTRICTED key with read access to
Subscriptions. The repair is printed, never performed, because this script holds
a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_pending_churn")

API = "https://api.stripe.com/v1"
DAY = 86400

ELEVATED_RATE = 0.10   # scheduled / active above this is a trend, not attrition
CLIFF_DAYS = 7         # a cancellation this close needs an answer this week


def scheduled_end(sub):
    """When service actually ends, or None if it is not scheduled to.

    Deliberately not `canceled_at`: that is populated when the flag is set, not
    when the subscription stops, and grouping by it dates the churn wrongly.
    """
    if sub.get("cancel_at"):
        return sub["cancel_at"]
    if not sub.get("cancel_at_period_end"):
        return None
    items = (sub.get("items") or {}).get("data") or []
    if items and items[0].get("current_period_end"):
        return items[0]["current_period_end"]
    return sub.get("current_period_end")


def verdict(scheduled, active_total, soonest_days):
    """Classify a pending-churn backlog. Pure, so the rules can be tested.

    `soonest_days` is days until the nearest scheduled end, or None if nothing
    is scheduled. Returns (state, detail).
    """
    if not active_total:
        return ("empty", "no active subscriptions in this account and mode")
    if not scheduled:
        return ("clear", "%d active subscription(s), none scheduled to cancel"
                % active_total)

    rate = scheduled / active_total
    summary = ("%d of %d active subscription(s) (%.1f%%) are scheduled to cancel"
               % (scheduled, active_total, rate * 100))

    if soonest_days is not None and soonest_days <= CLIFF_DAYS:
        return ("imminent",
                "%s, the first in %d day(s)" % (summary, soonest_days))
    if rate >= ELEVATED_RATE:
        return ("elevated",
                "%s. Above %d%% this is a trend with a cause, not attrition."
                % (summary, int(ELEVATED_RATE * 100)))
    return ("backlog", summary)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def active_subscriptions(session, limit):
    out = []
    params = {"status": "active", "limit": 100}
    while True:
        page = get(session, "/subscriptions", **params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-subscriptions", type=int, default=5000,
                    help="stop after this many active subscriptions")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    subs = active_subscriptions(s, args.max_subscriptions)
    now = int(time.time())

    ends = []
    reasons = {}
    for sub in subs:
        end = scheduled_end(sub)
        if end is None:
            continue
        ends.append(end)
        why = (sub.get("cancellation_details") or {}).get("feedback") or "not captured"
        reasons[why] = reasons.get(why, 0) + 1

    soonest = int((min(ends) - now) // DAY) if ends else None
    state, detail = verdict(len(ends), len(subs), soonest)

    if state in ("clear", "empty"):
        log.info("%-9s %s", state, detail)
        return 0

    log.warning("%-9s %s", state, detail)
    log.warning("  reasons: %s",
                ", ".join("%s x%d" % (k, v) for k, v in sorted(reasons.items())))
    if reasons.get("not captured"):
        log.warning("  repair: enable subscription_cancel.cancellation_reason on the "
                    "billing portal configuration so reasons are recorded")
    log.warning("  repair: per salvageable subscription, POST %s/subscriptions/{sub} "
                "-d cancel_at_period_end=false", API)
    log.warning("  repair: trigger the save offer from customer.subscription.updated "
                "on the day the flag flips")
    return 1


if __name__ == "__main__":
    sys.exit(main())
