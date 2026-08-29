"""Report Stripe report runs whose interval reached past the finalized data window.

Read only. Two GETs and no writes: give this a RESTRICTED key with read access to
Reports. The repair is printed, never performed, because this script holds a
credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_report_interval")

API = "https://api.stripe.com/v1"

# An interval_end landing this close to data_available_end is not safely covered:
# it is the same request that gets truncated on a night the pipeline runs late.
EDGE_HOURS = 1.0

# Past this, the availability window itself is the problem, not the interval.
STALE_HOURS = 36.0


def interval_state(interval_start, interval_end, available_start, available_end):
    """Compare one requested interval against a report type's availability window.

    Pure, so the boundary rules can be tested without a network. All four values
    are unix seconds; the availability values may be None on a type that has
    never produced data. Returns (state, detail).
    """
    if available_end is None or interval_end is None:
        return ("unknown",
                "no data_available_end or no interval_end to compare; the run "
                "cannot be judged either way")
    if interval_end > available_end:
        short = (interval_end - available_end) / 3600.0
        return ("truncated",
                "interval_end is %.1f hour(s) past data_available_end; the run "
                "succeeded and returned less than it asked for" % short)
    if (interval_start is not None and available_start is not None
            and interval_start < available_start):
        early = (available_start - interval_start) / 3600.0
        return ("before_window",
                "interval_start is %.1f hour(s) before data_available_start; the "
                "earliest part of the range does not exist" % early)
    margin = (available_end - interval_end) / 3600.0
    if margin < EDGE_HOURS:
        return ("at_edge",
                "interval_end is only %.2f hour(s) inside data_available_end; this "
                "run was a coin flip and will be short on a slower night" % margin)
    return ("covered",
            "fully inside the available window, with %.1f hour(s) to spare" % margin)


def freshness_state(available_end_age_hours):
    """Judge the availability window itself, independently of any run. Pure."""
    if available_end_age_hours is None:
        return ("unknown", "the report type reports no data_available_end")
    if available_end_age_hours >= STALE_HOURS:
        return ("stale",
                "data_available_end is %.1f hour(s) behind now; Stripe has not "
                "finalized recent data, so defer rather than retry"
                % available_end_age_hours)
    return ("fresh",
            "data_available_end is %.1f hour(s) behind now, which is normal lag"
            % available_end_age_hours)


def get(session, path, params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key has no read access to "
                         "this resource")
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
    ap.add_argument("--days", type=int, default=14,
                    help="how far back to read report runs")
    ap.add_argument("--report-type",
                    help="only check runs of this exact type id, version included")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    types = {t["id"]: t for t in page_all(s, "/reporting/report_types", {"limit": 100})}
    runs = page_all(s, "/reporting/report_runs",
                    {"limit": 100, "created[gte]": int(now - args.days * 86400)})
    if args.report_type:
        runs = [r for r in runs if r.get("report_type") == args.report_type]

    bad = 0
    stale_types = set()
    for r in runs:
        rt = types.get(r.get("report_type"), {})
        params = r.get("parameters") or {}
        state, detail = interval_state(params.get("interval_start"),
                                       params.get("interval_end"),
                                       rt.get("data_available_start"),
                                       rt.get("data_available_end"))
        if state in ("truncated", "before_window", "at_edge"):
            bad += 1
            log.warning("  %-13s %s  %s  %s", state, r.get("id"),
                        r.get("report_type"), detail)
        end = rt.get("data_available_end")
        age = None if end is None else (now - end) / 3600.0
        if freshness_state(age)[0] == "stale":
            stale_types.add(r.get("report_type"))

    for t in sorted(stale_types):
        end = types.get(t, {}).get("data_available_end")
        age = None if end is None else (now - end) / 3600.0
        log.warning("  %-13s %s  %s", "stale-window", t, freshness_state(age)[1])

    if not bad and not stale_types:
        log.info("%-11s %d run(s) checked, all fully inside the available window",
                 "clear", len(runs))
        return 0

    log.warning("%-11s %d of %d run(s) reached past what Stripe had finalized",
                "short", bad, len(runs))
    log.warning("  availability only moves forward, so anything flagged here was "
                "definitely short when it ran")
    log.warning("  gate the job on the type before creating the run:")
    log.warning("  GET %s/reporting/report_types/<type_id>   "
                "(create only while data_available_end >= interval_end)", API)
    log.warning("  and pin the version you depend on, e.g. balance.summary.1 rather "
                "than whichever is current")
    return 1


if __name__ == "__main__":
    sys.exit(main())
