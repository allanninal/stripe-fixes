"""Report subscriptions left with pause_collection and no resumes_at.

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
log = logging.getLogger("stripe_pause_collection")

API = "https://api.stripe.com/v1"
DAY = 86400

# Behaviours that dispose of the invoice as it is created. keep_as_draft, the
# remaining one, leaves something you can still finalise.
DISCARDING = ("void", "mark_uncollectible")


def verdict(sub, now):
    """Classify one subscription's pause_collection. Pure, so it can be tested.

    Note this never reads `status`: pause_collection leaves the status alone,
    which is exactly why the field needs a check of its own.
    Returns (state, detail).
    """
    pause = sub.get("pause_collection")
    if not pause:
        return ("collecting", "no pause on this subscription")

    behavior = pause.get("behavior") or "keep_as_draft"
    resumes = pause.get("resumes_at")

    if resumes is None:
        if behavior in DISCARDING:
            return ("unrecoverable",
                    "paused with no resumes_at and behavior %s: every invoice for "
                    "a paused period is disposed of as it is created" % behavior)
        return ("indefinite",
                "paused with no resumes_at and behavior %s: invoices accumulate "
                "as drafts that nothing will finalise" % behavior)

    if resumes <= now:
        return ("overdue",
                "resumes_at passed %d day(s) ago and collection is still paused"
                % ((now - resumes) // DAY))
    return ("scheduled",
            "resumes in %d day(s); this pause has an end" % ((resumes - now) // DAY))


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
    counts = {}
    for sub in subs:
        state, detail = verdict(sub, now)
        counts[state] = counts.get(state, 0) + 1
        if state in ("collecting", "scheduled"):
            continue
        log.warning("%-13s %s  %s", state, sub["id"], detail)
        log.warning("  repair: POST %s/subscriptions/%s -d pause_collection=",
                    API, sub["id"])
        if state == "indefinite":
            log.warning("  then per draft: POST %s/invoices/{inv} "
                        "-d auto_advance=true", API)

    indefinite = counts.get("indefinite", 0) + counts.get("unrecoverable", 0)
    log.info("%d active subscription(s), %d paused indefinitely, %d scheduled "
             "to resume", len(subs), indefinite, counts.get("scheduled", 0))
    if counts.get("overdue"):
        log.info("%d still paused past their own resumes_at", counts["overdue"])
    return 1 if indefinite or counts.get("overdue") else 0


if __name__ == "__main__":
    sys.exit(main())
