"""Report undelivered Stripe events approaching the 30-day retention cliff.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Events. The replay is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_event_retention")

API = "https://api.stripe.com/v1"

RETENTION_DAYS = 30   # events leave /v1/events entirely at this age
CRITICAL_DAYS = 29    # gone tomorrow
WARN_DAYS = 20        # still replayable, but schedule it now


def verdict(oldest_age_days, count):
    """Classify the backlog. Pure, so the boundaries can be tested without a network.

    `oldest_age_days` is the age of the oldest undelivered event in days, or None
    when nothing is undelivered. Returns (state, detail).
    """
    if not count:
        return ("clear", "0 undelivered event(s) in the retained window")
    if oldest_age_days is None:
        return ("unknown",
                "%d undelivered event(s) but no usable created timestamp" % count)
    left = RETENTION_DAYS - oldest_age_days
    if oldest_age_days >= CRITICAL_DAYS:
        return ("expiring",
                "%d event(s); the oldest is %.1f days old and leaves the API in "
                "under a day. Replay oldest first, now." % (count, oldest_age_days))
    if oldest_age_days >= WARN_DAYS:
        return ("aging",
                "%d event(s); the oldest expires in %.1f days. Schedule the replay "
                "rather than discussing it." % (count, left))
    return ("replayable",
            "%d event(s); the oldest expires in %.1f days. There is room to replay "
            "carefully." % (count, left))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def undelivered(session, limit):
    """Return (count, oldest_created, oldest_event_id) for undelivered events.

    Stripe returns events newest first, so the oldest one is on the last page and
    the pagination cannot be short-circuited if the age is to be trusted.
    """
    count = 0
    oldest = None
    oldest_id = None
    params = {"delivery_success": "false", "limit": 100}
    while True:
        page = get(session, "/events", **params)
        data = page.get("data", [])
        for ev in data:
            count += 1
            created = ev.get("created")
            if created is not None and (oldest is None or created < oldest):
                oldest, oldest_id = created, ev.get("id")
        if not data or not page.get("has_more") or count >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return count, oldest, oldest_id


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=5000,
                    help="stop paginating after this many undelivered events")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    count, oldest, oldest_id = undelivered(s, args.max_events)
    age = None if oldest is None else (time.time() - oldest) / 86400.0
    state, detail = verdict(age, count)

    line = "%-11s %s" % (state, detail)
    if state == "clear":
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  replay oldest first, walking backwards from the tail:")
    log.warning("  GET %s/events?delivery_success=false&ending_before=%s",
                API, oldest_id or "<evt_id>")
    if state == "expiring":
        log.warning("  anything already past %d days: reconcile from the objects "
                    "instead, which have no retention limit:", RETENTION_DAYS)
        log.warning("  GET %s/charges?created[gte]=<unix>   "
                    "GET %s/invoices?created[gte]=<unix>", API, API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
