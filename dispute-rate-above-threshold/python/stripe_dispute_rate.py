"""Measure the Stripe dispute rate against the card network thresholds.

Read only. Three paginated GETs and no writes: give this a RESTRICTED key with
read access to Disputes, Charges and Early Fraud Warnings. There is no API
toggle to repair this, so nothing here could write even if it wanted to; the
remediation is printed instead.
"""
import argparse
import calendar
import datetime as dt
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_dispute_rate")

API = "https://api.stripe.com/v1"

# Visa VAMP flags a merchant as non-compliant here.
WARN_RATE = 0.005
# Industry practice, and Stripe's own guidance, treats this as excessive.
EXCESSIVE_RATE = 0.0075
# Visa VAMP excessive, and Mastercard ECM once its own count floor is met.
PROGRAM_RATE = 0.015

# Below these counts the programmes do not apply, whatever the ratio says.
VAMP_FLOOR = 5      # disputes plus early fraud warnings
ECM_FLOOR = 100     # disputes alone


def rates(disputes, efws, charges):
    """Return (dispute_rate, vamp_rate). Pure.

    Both are None when there were no successful charges. A month with disputes
    and no charges is a data problem, not an infinite rate, and printing
    infinity would bury the real message.
    """
    if not charges:
        return (None, None)
    return (disputes / charges, (disputes + efws) / charges)


def assess(disputes, efws, charges,
           warn=WARN_RATE, excessive=EXCESSIVE_RATE, program=PROGRAM_RATE):
    """Classify a month of dispute activity. Pure. Returns (state, detail).

    The ratio and the count floors are separate tests on purpose: a high ratio
    on a handful of events is a signal worth reading, but it is not a breach,
    and reporting it as one wastes the credibility of the check.
    """
    dispute_rate, vamp_rate = rates(disputes, efws, charges)
    if dispute_rate is None:
        return ("no_volume",
                "no successful captured charges in the window; there is nothing "
                "to divide by")

    events = disputes + efws
    pct = "disputes %.3f%%, with EFW %.3f%%" % (dispute_rate * 100, vamp_rate * 100)

    if vamp_rate < warn:
        return ("clear", "%s, both under the %.2f%% VAMP line" % (pct, warn * 100))

    if events < VAMP_FLOOR and disputes < ECM_FLOOR:
        return ("below_floor",
                "%s, but only %d countable event(s). VAMP needs %d and ECM needs "
                "%d disputes, so no programme applies yet."
                % (pct, events, VAMP_FLOOR, ECM_FLOOR))

    if dispute_rate >= program or vamp_rate >= program:
        return ("program",
                "%s. At or above %.2f%% this is VAMP excessive territory, and "
                "Mastercard ECM once you pass %d disputes in a month."
                % (pct, program * 100, ECM_FLOOR))
    if dispute_rate >= excessive or vamp_rate >= excessive:
        return ("excessive",
                "%s. Above the %.2f%% the industry treats as excessive; expect "
                "monitoring before it reaches %.2f%%."
                % (pct, excessive * 100, program * 100))
    return ("watch",
            "%s. At or above the %.2f%% VAMP non-compliant line and below the "
            "%.2f%% excessive line: the month to act in."
            % (pct, warn * 100, excessive * 100))


def month_bounds(month):
    """Unix bounds for a YYYY-MM string, or the previous calendar month."""
    if month:
        year, mon = (int(p) for p in month.split("-"))
    else:
        today = dt.date.today()
        year, mon = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
    start = dt.datetime(year, mon, 1, tzinfo=dt.timezone.utc)
    last = calendar.monthrange(year, mon)[1]
    end = dt.datetime(year, mon, last, 23, 59, 59, tzinfo=dt.timezone.utc)
    return int(start.timestamp()), int(end.timestamp()) + 1, "%04d-%02d" % (year, mon)


def get(session, path, params=None):
    r = session.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def count(session, path, start, end, cap, keep=None):
    """Count objects in a created range. Returns (count, truncated).

    `truncated` is the whole point of the return being a tuple: a denominator
    that stopped early makes the ratio read high, and a confidently wrong ratio
    is worse than refusing to print one.
    """
    total = 0
    scanned = 0
    params = {"limit": 100, "created[gte]": start, "created[lt]": end}
    while True:
        page = get(session, path, params)
        data = page.get("data", [])
        for obj in data:
            scanned += 1
            if keep is None or keep(obj):
                total += 1
        if not data or not page.get("has_more"):
            return total, False
        if scanned >= cap:
            return total, True
        params["starting_after"] = data[-1]["id"]


def succeeded_and_captured(charge):
    return charge.get("status") == "succeeded" and charge.get("captured") is True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--month", help="YYYY-MM; defaults to the previous calendar month")
    ap.add_argument("--max-charges", type=int, default=50000,
                    help="refuse to report a ratio if the denominator needs more than this")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    start, end, label = month_bounds(args.month)
    log.info("counting %s", label)

    disputes, _ = count(s, "/disputes", start, end, cap=100000)
    efws, _ = count(s, "/radar/early_fraud_warnings", start, end, cap=100000)
    charges, truncated = count(s, "/charges", start, end,
                               cap=args.max_charges, keep=succeeded_and_captured)

    if truncated:
        log.error("stopped after %d charges, so the denominator is short and the "
                  "ratio would read high. Raise --max-charges or narrow the window.",
                  args.max_charges)
        return 2

    state, detail = assess(disputes, efws, charges)
    line = "%-12s %d dispute(s), %d EFW(s), %d successful charge(s): %s" % (
        state, disputes, efws, charges, detail)
    if state in ("clear", "no_volume"):
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  there is no API repair for a ratio: reduce the numerator.")
    log.warning("  block highest risk in Radar, request 3DS on elevated risk,")
    log.warning("  refund actionable early fraud warnings before they escalate,")
    log.warning("  set a recognisable statement descriptor, and make cancelling self-serve.")
    log.warning("  remediation guidance: https://docs.stripe.com/disputes/monitoring-programs")
    return 1 if state != "below_floor" else 0


if __name__ == "__main__":
    sys.exit(main())
