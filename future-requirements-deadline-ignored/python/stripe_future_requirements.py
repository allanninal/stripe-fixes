"""Report connected accounts whose future_requirements will disable a capability.

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
log = logging.getLogger("stripe_future_requirements")

API = "https://api.stripe.com/v1"

DAY = 86400


def verdict(account, now, soon_days=14):
    """Classify one account's future_requirements. Pure: `now` is an argument.

    Returns (state, detail). The states separate the three things a reader has to
    do differently: nothing, schedule it, or do it this week. Accounts whose
    requirements Stripe collects are excluded up front rather than reported as
    healthy, because their state is not yours to act on either way.
    """
    controller = account.get("controller") or {}
    if controller.get("requirement_collection") != "application":
        return ("stripe-managed",
                "Stripe collects for this account and handles the update itself")

    fr = account.get("future_requirements") or {}
    past = fr.get("past_due") or []
    due = fr.get("currently_due") or []
    eventually = fr.get("eventually_due") or []
    deadline = fr.get("current_deadline")

    if past:
        return ("overdue",
                "%d future field(s) already past due (%s)" % (len(past), ", ".join(past)))
    if due:
        if deadline is None:
            return ("undated",
                    "%d future field(s) with no deadline set yet (%s)"
                    % (len(due), ", ".join(due)))
        days = (deadline - now) / float(DAY)
        if days <= 0:
            return ("overdue",
                    "the deadline passed %.1f day(s) ago; these fields are moving "
                    "into requirements now" % (-days,))
        if days <= soon_days:
            return ("due-soon",
                    "%d future field(s) in %.1f day(s) (%s)"
                    % (len(due), days, ", ".join(due)))
        return ("scheduled",
                "%d future field(s) in %.1f day(s)" % (len(due), days))
    if eventually:
        return ("eventual",
                "%d field(s) Stripe will want at a later threshold" % len(eventually))
    return ("clear", "no future requirements")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def paginate(session, path, limit):
    """Walk a list endpoint, stopping once `limit` objects have been yielded."""
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
            if seen >= limit:
                return
        if not page.get("has_more") or not data:
            return
        params["starting_after"] = data[-1]["id"]


ORDER = {"overdue": 0, "due-soon": 1, "scheduled": 2, "undated": 3, "eventual": 4}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-accounts", type=int, default=500,
                    help="stop after this many connected accounts")
    ap.add_argument("--soon-days", type=int, default=14,
                    help="a deadline inside this many days is urgent")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    total = 0
    rows = []
    for acct in paginate(s, "/accounts", args.max_accounts):
        total += 1
        state, detail = verdict(acct, now, args.soon_days)
        if state in ("clear", "stripe-managed"):
            continue
        fr = acct.get("future_requirements") or {}
        rows.append((ORDER.get(state, 9),
                     fr.get("current_deadline") or float("inf"),
                     state, acct["id"], detail))

    rows.sort()
    for _, _, state, acct_id, detail in rows:
        log.warning("%-11s %s  %s", state, acct_id, detail)
        log.warning("  repair: POST %s/accounts/%s with the future field(s) before "
                    "the deadline", API, acct_id)
        log.warning("  hosted: create an account link with "
                    "collection_options[future_requirements]=include")

    counts = {}
    for _, _, state, _, _ in rows:
        counts[state] = counts.get(state, 0) + 1
    log.info("%d account(s): %d overdue, %d due within %d days, %d scheduled, %d undated",
             total, counts.get("overdue", 0), counts.get("due-soon", 0),
             args.soon_days, counts.get("scheduled", 0), counts.get("undated", 0))
    return 1 if counts.get("overdue") or counts.get("due-soon") else 0


if __name__ == "__main__":
    sys.exit(main())
