"""Report Stripe report runs that failed, stalled in pending, or never happened.

Read only. Two paginated GETs and no writes: give this a RESTRICTED key with read
access to Reports and Webhook Endpoints. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import datetime as dt
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_report_runs")

API = "https://api.stripe.com/v1"

# A run still pending past this is not being worked on. The standard report types
# resolve in seconds; an hour is already several orders of magnitude of slack.
STALL_SECONDS = 3600

FAILURE_EVENT = "reporting.report_run.failed"


def run_state(status, age_seconds, error=None):
    """Classify one report run. Pure, so the pending deadline can be tested offline.

    `age_seconds` is how long ago the run was created. Returns (state, detail).
    """
    if status == "succeeded":
        return ("succeeded", "finished, result file available")
    if status == "failed":
        return ("failed", error or "failed with no error message on the run")
    if status == "pending":
        if age_seconds is not None and age_seconds >= STALL_SECONDS:
            return ("stalled",
                    "pending for %.1f hour(s); nothing is working on it, treat it "
                    "as failed" % (age_seconds / 3600.0))
        return ("running", "pending, still inside the %d second window"
                % STALL_SECONDS)
    return ("unknown", "unrecognised status %r" % (status,))


def verdict(states, missing_days, failure_subscribed):
    """Fold run states, schedule gaps and webhook coverage into one verdict. Pure.

    `states` is the list of per-run states, `missing_days` the expected UTC dates
    with no successful run, `failure_subscribed` whether any endpoint listens for
    reporting.report_run.failed.
    """
    failed = states.count("failed")
    stalled = states.count("stalled")
    if not states:
        return ("silent",
                "no report runs at all in the window; the export never reached "
                "Stripe, so there is nothing here to have failed")
    if failed or stalled:
        return ("failing",
                "%d run(s): %d failed, %d stalled in pending, %d expected day(s) "
                "with no successful run"
                % (len(states), failed, stalled, len(missing_days)))
    if missing_days:
        return ("gaps",
                "%d run(s), none failed, but %d expected day(s) have no successful "
                "run: %s" % (len(states), len(missing_days),
                             ", ".join(missing_days[:5])))
    if not failure_subscribed:
        return ("unwatched",
                "%d run(s), all successful, but nothing subscribes to %s, so the "
                "next failure is silent" % (len(states), FAILURE_EVENT))
    return ("clear",
            "%d run(s), 0 failed, 0 stalled, no missing days, failures subscribed"
            % len(states))


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
    """Collect every page, oldest last: Stripe returns these lists newest first."""
    out = []
    params = dict(params)
    while True:
        page = get(session, path, params)
        data = page.get("data", [])
        out.extend(data)
        if not data or not page.get("has_more") or len(out) >= cap:
            return out
        params["starting_after"] = data[-1]["id"]


def expected_days(now, days):
    """UTC dates a nightly export should have covered, excluding today."""
    today = dt.datetime.utcfromtimestamp(now).date()
    return [(today - dt.timedelta(days=n)).isoformat() for n in range(1, days + 1)]


def failure_is_subscribed(endpoints):
    for ep in endpoints:
        if ep.get("status") == "disabled":
            continue
        events = ep.get("enabled_events") or []
        if FAILURE_EVENT in events or "*" in events:
            return True
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to read report runs")
    ap.add_argument("--report-type",
                    help="only consider runs of this report type, e.g. balance.summary.1")
    ap.add_argument("--no-daily", action="store_true",
                    help="do not expect one successful run per day")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    runs = page_all(s, "/reporting/report_runs",
                    {"limit": 100, "created[gte]": int(now - args.days * 86400)})
    if args.report_type:
        runs = [r for r in runs if r.get("report_type") == args.report_type]

    states = []
    succeeded_days = set()
    for r in runs:
        created = r.get("created")
        age = None if created is None else now - created
        state, detail = run_state(r.get("status"), age, r.get("error"))
        states.append(state)
        if state == "succeeded" and r.get("succeeded_at"):
            succeeded_days.add(
                dt.datetime.utcfromtimestamp(r["succeeded_at"]).date().isoformat())
        if state in ("failed", "stalled", "unknown"):
            log.warning("  %-9s %s  %s  %s", state, r.get("id"),
                        r.get("report_type"), detail)

    missing = ([] if args.no_daily
               else [d for d in expected_days(now, args.days) if d not in succeeded_days])

    endpoints = page_all(s, "/webhook_endpoints", {"limit": 100})
    subscribed = failure_is_subscribed(endpoints)

    state, detail = verdict(states, missing, subscribed)
    line = "%-11s %s" % (state, detail)
    if state == "clear":
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  read the reason off the run, then re-issue it:")
    log.warning("  GET %s/reporting/report_runs/<frr_id>   (read .error, .parameters)", API)
    log.warning("  POST %s/reporting/report_runs with the corrected interval, then "
                "poll until status leaves pending", API)
    if not subscribed:
        log.warning("  and subscribe an endpoint so the next one is loud:")
        log.warning("  POST %s/webhook_endpoints/<we_id> "
                    "enabled_events[]=%s enabled_events[]=reporting.report_run.succeeded",
                    API, FAILURE_EVENT)
    return 1


if __name__ == "__main__":
    sys.exit(main())
