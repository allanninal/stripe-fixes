"""Report Stripe events whose deliveries are still outstanding hours after they fired.

Read only. One paginated GET, no writes: give this a RESTRICTED key with read
access to Events. The repair is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_pending_webhooks")

API = "https://api.stripe.com/v1"

# An event younger than this is a delivery in progress, not a failure.
GRACE_SECONDS = 3600

# A single type holding this share of the stuck events is a handler branch.
CONCENTRATED = 0.8

# Stuck events at this share of the whole sample is an endpoint level failure.
WIDESPREAD = 0.5


def verdict(sampled, stuck, top_type, top_count):
    """Classify a window of events. Pure, so the rules can be tested offline.

    `sampled` is how many events were old enough to judge, `stuck` how many of
    those still have pending_webhooks above zero, and `top_type`/`top_count` the
    most common type among the stuck ones. Returns (state, detail).
    """
    if sampled <= 0:
        return ("empty",
                "no events older than the grace period in the retained window: "
                "nothing here can be judged yet")
    if stuck <= 0:
        return ("clear",
                "%d event(s) older than the grace period, all delivered" % sampled)
    share = top_count / float(stuck)
    if share >= CONCENTRATED:
        return ("one-branch",
                "%d of %d stuck event(s) are %s. That is one handler branch "
                "failing, not the endpoint." % (top_count, stuck, top_type))
    if stuck / float(sampled) >= WIDESPREAD:
        return ("endpoint-wide",
                "%d of %d sampled event(s) never got a 2xx, across %s and other "
                "types. The route is timing out or answering with a redirect."
                % (stuck, sampled, top_type))
    return ("intermittent",
            "%d of %d sampled event(s) stuck, spread across types. This is the "
            "handler running out of time under load rather than one bad branch."
            % (stuck, sampled))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key lacks read access to "
                         + path)
    r.raise_for_status()
    return r.json()


def scan(session, cutoff, limit):
    """Count events older than `cutoff` and tally the stuck ones by type."""
    sampled = 0
    stuck = 0
    by_type = {}
    params = {"limit": 100, "created[lt]": cutoff}
    while True:
        page = get(session, "/events", **params)
        data = page.get("data", [])
        for ev in data:
            sampled += 1
            if (ev.get("pending_webhooks") or 0) > 0:
                stuck += 1
                t = ev.get("type", "unknown")
                by_type[t] = by_type.get(t, 0) + 1
        if not data or not page.get("has_more") or sampled >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return sampled, stuck, by_type


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=1000,
                    help="stop after sampling this many events")
    ap.add_argument("--grace", type=int, default=GRACE_SECONDS,
                    help="ignore events younger than this many seconds")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    cutoff = int(time.time()) - args.grace
    sampled, stuck, by_type = scan(s, cutoff, args.max_events)

    # Sorted by count then name so a tie reports the same type on every run.
    ranked = sorted(by_type.items(), key=lambda kv: (-kv[1], kv[0]))
    top_type, top_count = ranked[0] if ranked else ("none", 0)

    state, detail = verdict(sampled, stuck, top_type, top_count)
    if state in ("empty", "clear"):
        log.info("%-13s %s", state, detail)
        return 0

    log.warning("%-13s %s", state, detail)
    for t, n in ranked[:8]:
        log.warning("  %5d  %s", n, t)
    log.warning("  repair: return 200 as soon as the signature verifies and move "
                "the work to a queue. A slow 200 is a failed delivery.")
    log.warning("  then replay: GET %s/events?delivery_success=false paginated "
                "oldest first, guarded by your processed event table", API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
