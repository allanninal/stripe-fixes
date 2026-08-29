"""Report Stripe Terminal readers that are offline, stale, wedged or behind on firmware.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Terminal. The repair is printed, never performed, because this script
holds a credential to a live payments account.
"""
import argparse
import collections
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_terminal_readers")

API = "https://api.stripe.com/v1"

# last_seen_at is in MILLISECONDS, unlike almost every other Stripe timestamp.
# Anything below this is a seconds value that has been passed in by mistake:
# 1e11 ms is 1973, and 1e11 seconds is the year 5138, so no real reading is
# ambiguous. Refusing to judge beats reporting a fleet as decades stale.
MS_FLOOR = 100_000_000_000

STALE_HOURS = 6.0


def reader_state(status, last_seen_at_ms, now_ms, action_status=None,
                 failure_code=None, stale_hours=STALE_HOURS):
    """Classify one Terminal reader. Pure, so the units guard can be tested offline.

    `last_seen_at_ms` and `now_ms` are both milliseconds. Returns (state, detail).
    """
    if last_seen_at_ms is not None and last_seen_at_ms < MS_FLOOR:
        return ("unknown",
                "last_seen_at is %d, which is a seconds timestamp; this reader "
                "cannot be judged until the units are right" % last_seen_at_ms)
    age_h = (None if last_seen_at_ms is None
             else (now_ms - last_seen_at_ms) / 3_600_000.0)
    if status == "offline":
        seen = "never seen" if age_h is None else "last seen %.1f hour(s) ago" % age_h
        return ("offline", "status offline, %s; it will not take a payment" % seen)
    if age_h is None:
        return ("unknown", "no last_seen_at, so liveness cannot be confirmed")
    if age_h >= stale_hours:
        return ("stale",
                "status %s but no check-in for %.1f hour(s); status lags reality, "
                "so treat this as unusable" % (status, age_h))
    if action_status == "failed":
        return ("action_failed",
                "reachable but wedged on a failed action: %s"
                % (failure_code or "no failure_code on the action"))
    if status == "online":
        return ("online", "checked in %.1f hour(s) ago" % age_h)
    return ("unknown", "unrecognised status %r" % (status,))


def firmware_outliers(readers):
    """Readers not on the version most of their own device_type is running. Pure.

    `readers` is a list of dicts with id, device_type and device_sw_version. A
    device type with a single reader has no majority and is skipped rather than
    reported as an outlier against itself.
    """
    by_type = collections.defaultdict(list)
    for r in readers:
        by_type[r.get("device_type")].append(r)
    out = []
    for device_type, group in sorted(by_type.items(), key=lambda kv: str(kv[0])):
        versions = collections.Counter(r.get("device_sw_version") for r in group
                                       if r.get("device_sw_version"))
        if len(group) < 2 or not versions:
            continue
        majority, _ = versions.most_common(1)[0]
        for r in group:
            v = r.get("device_sw_version")
            if v and v != majority:
                out.append((r.get("id"), device_type, v, majority))
    return out


def get(session, path, params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key has no read access to "
                         "Terminal")
    r.raise_for_status()
    return r.json()


def page_all(session, path, params, cap=2000):
    out = []
    params = dict(params)
    while True:
        page = get(session, path, params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= cap:
            return out
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--location", help="only check readers at this location id")
    ap.add_argument("--stale-hours", type=float, default=STALE_HOURS,
                    help="check-in age past which a reader is unusable")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    params = {"limit": 100}
    if args.location:
        params["location"] = args.location
    readers = page_all(s, "/terminal/readers", params)

    now_ms = int(time.time() * 1000)
    bad = 0
    freshest = None
    for r in readers:
        action = r.get("action") or {}
        state, detail = reader_state(r.get("status"), r.get("last_seen_at"), now_ms,
                                     action.get("status"), action.get("failure_code"),
                                     args.stale_hours)
        seen = r.get("last_seen_at")
        if seen and seen >= MS_FLOOR and (freshest is None or seen > freshest):
            freshest = seen
        if state != "online":
            bad += 1
            log.warning("  %-13s %s  %s  %s", state, r.get("id"),
                        r.get("label") or r.get("device_type"), detail)

    drift = firmware_outliers(readers)
    for rid, device_type, version, majority in drift:
        log.warning("  %-13s %s  %s on %s, the rest of the fleet is on %s",
                    "firmware", rid, device_type, version, majority)

    if not bad and not drift:
        age = 0.0 if freshest is None else (now_ms - freshest) / 3_600_000.0
        log.info("%-11s %d reader(s) online, newest check-in %.1fh, firmware consistent",
                 "clear", len(readers), age)
        return 0

    log.warning("%-11s %d of %d reader(s) not usable, %d on odd firmware",
                "offline", bad, len(readers), len(drift))
    log.warning("  power-cycle the reader and confirm the location's network reaches "
                "Stripe, then re-check:")
    log.warning("  GET %s/terminal/readers/<tmr_id>   "
                "(want status online AND a fresh last_seen_at)", API)
    log.warning("  leave drifting readers powered and connected through their "
                "configured update window")
    log.warning("  retire dead hardware so it stops filling this report:")
    log.warning("  DELETE %s/terminal/readers/<tmr_id>", API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
