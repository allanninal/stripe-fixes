"""Turn requirements.current_deadline into a dated queue of connected accounts.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Connected accounts. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_current_deadline")

API = "https://api.stripe.com/v1"

DAY = 86400


def days_left(requirements, now):
    """Whole days from `now` to requirements.current_deadline. None if unset.

    Pure, and the clock is an argument. Negative means the deadline has passed.
    """
    deadline = (requirements or {}).get("current_deadline")
    if deadline is None:
        return None
    return int((deadline - now) // DAY)


def cohort_day(deadline):
    """The UTC calendar date a deadline falls on, as YYYY-MM-DD, or None.

    Deadlines cluster: accounts that crossed a processing threshold in the same
    month share a date, and grouping by that date is what turns a list of account
    ids into one scheduled piece of work.
    """
    if deadline is None:
        return None
    return time.strftime("%Y-%m-%d", time.gmtime(deadline))


def horizon(account, now, window=14):
    """Classify one account's current deadline. Pure. Returns (state, detail).

    The states exist to separate three different jobs: an incident that has
    already happened, a batch of accounts to chase this week, and work to put in
    the calendar. An account with a deadline and nothing outstanding is a fourth
    thing: Stripe verifying what it already holds, with nothing for you to do.
    """
    reqs = account.get("requirements") or {}
    due = [f for f in (reqs.get("currently_due") or []) if f]
    left = days_left(reqs, now)

    if left is None:
        if due:
            return ("undated",
                    "%d field(s) currently due with no deadline set yet: real work, "
                    "no date to plan it around" % len(due))
        return ("clear", "no deadline and nothing currently due")

    when = cohort_day(reqs.get("current_deadline"))

    if left < 0:
        if due:
            return ("enforced",
                    "deadline passed %d day(s) ago on %s with %d field(s) still due: "
                    "these have moved into past_due and the capability is already off"
                    % (-left, when, len(due)))
        return ("passed",
                "deadline passed on %s with nothing outstanding: it was met" % when)

    if not due:
        return ("verifying",
                "deadline %s in %d day(s) with nothing currently due: Stripe is "
                "checking what it already has, so there is nothing to collect"
                % (when, left))

    if left <= window:
        return ("urgent",
                "%d day(s) left, due %s, %d field(s): %s"
                % (left, when, len(due), ", ".join(due[:4])))

    return ("scheduled",
            "%d day(s) left, due %s, %d field(s): %s"
            % (left, when, len(due), ", ".join(due[:4])))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def accounts(session, cap):
    """Yield connected accounts, paginating until Stripe stops or the cap is hit."""
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(session, "/accounts", **params)
        data = page.get("data", [])
        for acct in data:
            yield acct
            seen += 1
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--window-days", type=int, default=14,
                    help="how many days out counts as urgent rather than scheduled")
    ap.add_argument("--max-accounts", type=int, default=5000,
                    help="stop paginating after this many accounts")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})
    now = int(time.time())

    rows = []
    counts = {}
    scanned = 0
    for acct in accounts(s, args.max_accounts):
        scanned += 1
        state, detail = horizon(acct, now, args.window_days)
        counts[state] = counts.get(state, 0) + 1
        if state in ("clear", "passed"):
            continue
        reqs = acct.get("requirements") or {}
        rows.append((days_left(reqs, now), cohort_day(reqs.get("current_deadline")),
                     acct.get("id", "acct_?"), state, detail))

    # Nearest deadline first; undated accounts last, since they are work you know
    # about with a date you do not.
    rows.sort(key=lambda r: (r[0] is None, r[0] if r[0] is not None else 0))
    for _left, _day, acct_id, state, detail in rows:
        log.warning("%s  %-10s %s", acct_id, state, detail)

    calendar = {}
    for _left, day, _id, state, _detail in rows:
        if day and state in ("urgent", "scheduled"):
            calendar[day] = calendar.get(day, 0) + 1

    log.info("%d account(s): %d enforced, %d inside %d days, %d scheduled across "
             "%d date(s)", scanned, counts.get("enforced", 0), counts.get("urgent", 0),
             args.window_days, counts.get("scheduled", 0), len(calendar))
    for day in sorted(calendar):
        log.info("  %s  %d account(s) fall due together", day, calendar[day])

    if counts.get("enforced"):
        log.warning("  the enforced accounts are already disabled: read past_due, not "
                    "currently_due, and treat them as an incident")
    if counts.get("urgent") or counts.get("scheduled"):
        log.warning("  repair: for each account, create an onboarding link and email it:")
        log.warning("  POST %s/account_links with account={id}, "
                    "type=account_onboarding, refresh_url, return_url,", API)
        log.warning("  collection_options[fields]=eventually_due  "
                    "(eventually_due, so the account does not come back next quarter)")
    if counts.get("undated"):
        log.warning("  the undated accounts have fields due and no deadline yet: "
                    "collect now rather than waiting for a date to appear")

    return 1 if (counts.get("enforced") or counts.get("urgent")
                 or counts.get("undated")) else 0


if __name__ == "__main__":
    sys.exit(main())
