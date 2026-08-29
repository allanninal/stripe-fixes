"""Report the Stripe account's default API version and how far behind it is.

Read only. One GET and no writes: give this a RESTRICTED key with read access to
Events. The upgrade is printed, never performed, because this script holds a
credential to a live payments account.

Deliberately uses a plain HTTP client rather than an SDK. Every official Stripe
library sends its own Stripe-Version header, and Stripe honours it, so an
SDK-based version of this script reads back the library's version and reports it
as the account's.
"""
import argparse
import datetime as dt
import logging
import os
import re
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_account_api_version")

API = "https://api.stripe.com/v1"

CURRENT_LINE = "2025-09-30"  # Clover
DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})")
YEAR = 365


def authority(event_version, header_version):
    """Decide which of the two indirect readings to believe. Pure.

    Returns (version, note). The response header is the default right now; the
    newest event is the default at the moment that event was created. When they
    disagree the account moved recently, and that is worth saying out loud.
    """
    if not event_version and not header_version:
        return (None,
                "no reading available: no events in the 30 day window and no "
                "Stripe-Version on the response")
    if header_version and not event_version:
        return (header_version,
                "from the Stripe-Version response header; no events in the "
                "window to corroborate it")
    if event_version and not header_version:
        return (event_version,
                "from the newest event; the response carried no Stripe-Version "
                "header, so this is the default as of that event and not now")
    if str(header_version).split(".")[0] != str(event_version).split(".")[0]:
        return (header_version,
                "the header says %s and the newest event says %s: the default "
                "moved after that event, or was rolled back inside the 72 hour "
                "window. The retained events span both shapes."
                % (header_version, event_version))
    return (header_version, "header and newest event agree")


def verdict(version, today, current_line=CURRENT_LINE):
    """How far behind the account default is. Pure.

    `today` is an ISO date string and is an argument rather than a call to
    date.today() so the tests keep the same answer as the calendar moves.
    """
    if not version:
        return ("unknown",
                "nothing to judge: the account default could not be read from "
                "an event or from a response header")
    m = DATE.match(str(version))
    if not m:
        return ("unreadable",
                "%r has no YYYY-MM-DD prefix to compare" % (version,))
    date = m.group(1)
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=YEAR)).isoformat()
    if date < cutoff:
        return ("stale",
                "the account default is %s, more than a year behind. Read the "
                "changelog for every release line between %s and %s; the "
                "breaking changes accumulate rather than replace each other."
                % (date, date, current_line))
    if date < current_line:
        return ("trailing",
                "the account default is %s, behind the current %s line but "
                "within a year of it. One changelog to read."
                % (date, current_line))
    return ("current", "the account default is %s, on the current line" % date)


def read_default(session):
    """One GET, read twice: the newest event's version and the response header."""
    r = session.get(API + "/events", params={"limit": 1}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    data = r.json().get("data", [])
    event_version = data[0].get("api_version") if data else None
    return event_version, r.headers.get("Stripe-Version")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--current-line", default=CURRENT_LINE,
                    help="the release line to measure against, as YYYY-MM-DD")
    ap.add_argument("--today", default=dt.date.today().isoformat(),
                    help="ISO date to measure the gap from, for reproducible runs")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    # No Stripe-Version header here on purpose: that is what makes the response
    # header report the account default rather than echo a version we chose.
    s.headers.update({"Authorization": "Bearer " + key})

    event_version, header_version = read_default(s)
    version, note = authority(event_version, header_version)
    state, detail = verdict(version, args.today, args.current_line)

    log.info("  %-9s %s", state, version or "unknown")
    log.info("  %s", note)

    if state == "current":
        log.info("%s  %s", state, detail)
        return 0

    log.warning("%s  %s", state, detail)
    log.warning("  test first without changing anything: send a per-request "
                "Stripe-Version: %s header and run your integration against it",
                args.current_line)
    log.warning("  then upgrade in the Dashboard: Workbench, Overview, API "
                "versions, Upgrade available")
    log.warning("  you get a 72 hour rollback window, during which webhooks that "
                "fail on the new shape are retried with the old structure")
    return 1


if __name__ == "__main__":
    sys.exit(main())
