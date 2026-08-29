"""Separate connected accounts that are already disabled from ones merely due.

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
log = logging.getLogger("stripe_requirements_past_due")

API = "https://api.stripe.com/v1"

# A deadline further out than this is a scheduled task; inside it, an email today.
NEAR_DEADLINE_DAYS = 14


def classify(requirements, now, near_days=NEAR_DEADLINE_DAYS):
    """Sort one account's requirements object. Pure, so the nesting can be tested.

    eventually_due contains currently_due contains past_due, so the arrays are
    read innermost first. Returns (state, detail).
    """
    reqs = requirements or {}
    past = [f for f in (reqs.get("past_due") or []) if f]
    current = [f for f in (reqs.get("currently_due") or []) if f]
    pending = [f for f in (reqs.get("pending_verification") or []) if f]
    eventual = [f for f in (reqs.get("eventually_due") or []) if f]
    deadline = reqs.get("current_deadline")

    if past:
        return ("past-due",
                "%d field(s) past the deadline, so the capabilities that need them "
                "are already off: %s" % (len(past), ", ".join(past[:4])))

    if current:
        if isinstance(deadline, (int, float)):
            days = (deadline - now) / 86400.0
            if days < 0:
                return ("overdue",
                        "current_deadline passed %.1f days ago with %d field(s) "
                        "still due: expect past_due next" % (-days, len(current)))
            if days <= near_days:
                return ("deadline",
                        "%d field(s) due and current_deadline is %.1f days away: %s"
                        % (len(current), days, ", ".join(current[:4])))
            return ("due",
                    "%d field(s) due, %.1f days of deadline left"
                    % (len(current), days))
        return ("due",
                "%d field(s) currently due with no deadline set yet"
                % len(current))

    if pending:
        return ("pending",
                "%d field(s) submitted and under verification: nothing to collect"
                % len(pending))

    if eventual:
        return ("eventual",
                "%d field(s) eventually due, none of them urgent" % len(eventual))

    return ("clear", "no outstanding requirements")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def accounts(session, cap):
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
    ap.add_argument("--near-days", type=int, default=NEAR_DEADLINE_DAYS,
                    help="treat a deadline inside this many days as urgent")
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
    counts = {}
    urgent = []
    scanned = 0

    for acct in accounts(s, args.max_accounts):
        scanned += 1
        state, detail = classify(acct.get("requirements"), now, args.near_days)
        counts[state] = counts.get(state, 0) + 1
        if state in ("past-due", "overdue", "deadline"):
            deadline = (acct.get("requirements") or {}).get("current_deadline") or 0
            urgent.append((deadline, acct.get("id", "acct_?"), state, detail,
                           acct.get("payouts_enabled")))

    # Soonest deadline first: this list is a work queue, not a report.
    for deadline, acct_id, state, detail, payouts in sorted(urgent):
        log.warning("%s  %-9s payouts_enabled=%s  %s",
                    acct_id, state, payouts, detail)

    log.info("%d account(s): %d past due, %d with a deadline inside %d days",
             scanned, counts.get("past-due", 0) + counts.get("overdue", 0),
             counts.get("deadline", 0), args.near_days)

    if counts.get("past-due") or counts.get("overdue"):
        log.warning("  repair: per-capability detail first, since the account level "
                    "arrays flatten several capabilities together:")
        log.warning("  GET %s/accounts/{id}/capabilities", API)
        log.warning("  repair: update the account with every string listed in "
                    "requirements.past_due, or send an onboarding account link")
    if counts.get("deadline") or counts.get("due"):
        log.warning("  repair: collect eventually_due rather than currently_due so "
                    "the account does not re-enter this state at the next threshold")
    return 1 if (counts.get("past-due") or counts.get("overdue")
                 or counts.get("deadline")) else 0


if __name__ == "__main__":
    sys.exit(main())
