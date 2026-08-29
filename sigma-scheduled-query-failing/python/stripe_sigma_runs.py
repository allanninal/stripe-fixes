"""Report Sigma scheduled query runs that failed, timed out, or stopped happening.

Read only. Two paginated GETs and no writes: give this a RESTRICTED key with read
access to Sigma and Webhook Endpoints. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_sigma_runs")

API = "https://api.stripe.com/v1"

RUN_EVENT = "sigma.scheduled_query_run.created"

# A schedule that has produced nothing for twice its cadence is not quiet, it has
# stopped. One missed run can be a blip; two in a row never is.
MISSED_CADENCES = 2.0


def run_state(status, error, seconds_until_expiry):
    """Classify one scheduled query run. Pure, so it can be tested offline.

    `seconds_until_expiry` is result_available_until minus now, or None when the
    run has no result. Returns (state, detail).
    """
    if status == "completed":
        if seconds_until_expiry is not None and seconds_until_expiry <= 0:
            return ("expired",
                    "completed, but the result expired %.1f hour(s) ago; the run "
                    "succeeded and the file is gone"
                    % (-seconds_until_expiry / 3600.0))
        return ("completed", "completed with a result still available")
    if status == "timed_out":
        return ("timed_out",
                "the query ran past its execution budget; it will keep doing that "
                "until it is narrowed, because the data only grows")
    if status == "failed":
        return ("failed", error or "failed with no error message on the run")
    if status == "canceled":
        return ("canceled", "canceled, which is usually a person rather than a fault")
    return ("unknown", "unrecognised status %r" % (status,))


def verdict(states, hours_since_newest, cadence_hours, run_event_subscribed):
    """Fold run states, schedule liveness and webhook coverage into one verdict.

    Pure. `hours_since_newest` is None when there are no runs at all.
    """
    broken = states.count("timed_out") + states.count("failed")
    expired = states.count("expired")
    if not states:
        return ("silent",
                "no scheduled query runs at all; either no schedule exists or it "
                "has never produced a run")
    if broken:
        return ("failing",
                "%d of %d run(s) ended in timed_out or failed; narrow the query "
                "rather than retrying it" % (broken, len(states)))
    if (hours_since_newest is not None
            and hours_since_newest > MISSED_CADENCES * cadence_hours):
        return ("missing",
                "no run for %.1f hour(s) against a cadence of %.0f hour(s); the "
                "schedule has stopped producing runs"
                % (hours_since_newest, cadence_hours))
    if expired:
        return ("expired_results",
                "%d completed run(s) whose result has already expired; the data is "
                "gone even though nothing failed" % expired)
    if not run_event_subscribed:
        return ("email_only",
                "%d run(s), all completed, but nothing subscribes to %s, so a run "
                "that stops happening has no signal at all" % (len(states), RUN_EVENT))
    return ("clear",
            "%d run(s), all completed, results consumed by webhook" % len(states))


def get(session, path, params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code == 403:
        raise SystemExit("403 from Stripe: the restricted key has no read access to "
                         "Sigma, or Sigma is not enabled on this account")
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


def run_event_is_subscribed(endpoints):
    for ep in endpoints:
        if ep.get("status") == "disabled":
            continue
        events = ep.get("enabled_events") or []
        if RUN_EVENT in events or "*" in events:
            return True
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cadence-hours", type=float, default=24.0,
                    help="how often you expect a run, in hours (168 for weekly)")
    ap.add_argument("--limit", type=int, default=200,
                    help="stop after this many runs")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    runs = page_all(s, "/sigma/scheduled_query_runs", {"limit": 100}, cap=args.limit)

    states = []
    newest = None
    for r in runs:
        until = r.get("result_available_until")
        left = None if until is None else until - now
        state, detail = run_state(r.get("status"), r.get("error"), left)
        states.append(state)
        loaded = r.get("data_load_time")
        if loaded is not None and (newest is None or loaded > newest):
            newest = loaded
        if state not in ("completed",):
            log.warning("  %-9s %s  %s  %s", state, r.get("id"),
                        r.get("title") or "<untitled>", detail)

    hours_since = None if newest is None else (now - newest) / 3600.0
    endpoints = page_all(s, "/webhook_endpoints", {"limit": 100})
    subscribed = run_event_is_subscribed(endpoints)

    state, detail = verdict(states, hours_since, args.cadence_hours, subscribed)
    line = "%-11s %s" % (state, detail)
    if state == "clear":
        log.info(line)
        return 0

    log.warning(line)
    if state in ("failing", "missing", "silent"):
        log.warning("  narrow the query in Dashboard > Data > Sigma: add a created >= "
                    "bound, drop wide joins, select fewer columns, then re-save it")
    if not subscribed:
        log.warning("  consume results programmatically instead of by email:")
        log.warning("  POST %s/webhook_endpoints/<we_id> enabled_events[]=%s",
                    API, RUN_EVENT)
        log.warning("  then GET https://files.stripe.com/v1/files/<file_id>/contents "
                    "before result_available_until")
    return 1


if __name__ == "__main__":
    sys.exit(main())
