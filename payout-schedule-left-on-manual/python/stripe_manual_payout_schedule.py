"""Report connected accounts whose payout schedule leaves money stranded.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Connected accounts, Balance and Payouts. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_manual_payout_schedule")

API = "https://api.stripe.com/v1"

STALE_DAYS = 30      # a manual account with money and no payout this recently
SLOW_DELAY_DAYS = 14  # well above any country minimum


def classify(account, available, last_payout_age_days):
    """Sort one connected account by its payout schedule. Pure, so the boundary
    between a deliberate manual schedule and stranded money can be tested.

    `available` is the summed available balance for that account in minor units,
    or None when it was not read. `last_payout_age_days` is the age of the most
    recent payout in days, or None when the account has never had one.

    Returns (state, detail).
    """
    schedule = (((account.get("settings") or {}).get("payouts") or {})
                .get("schedule") or {})
    interval = schedule.get("interval")
    delay = schedule.get("delay_days")
    held = available or 0

    if not account.get("payouts_enabled"):
        return ("disabled",
                "payouts_enabled is false: the schedule is not what is stopping "
                "the money, so fix the requirements first")

    if interval == "manual":
        if held <= 0:
            return ("manual",
                    "manual schedule with nothing available: intentional or not, "
                    "no money is stuck right now")
        if last_payout_age_days is None:
            return ("stranded",
                    "manual schedule, %d available and no payout has ever been "
                    "created: nothing is going to move it" % held)
        if last_payout_age_days >= STALE_DAYS:
            return ("stranded",
                    "manual schedule, %d available and the last payout was %.0f "
                    "days ago: whatever creates them has stopped"
                    % (held, last_payout_age_days))
        return ("manual",
                "manual schedule, %d available and a payout %.0f days ago: a job "
                "is running" % (held, last_payout_age_days))

    if interval is None:
        return ("unknown",
                "no settings.payouts.schedule.interval on the account object")

    if isinstance(delay, int) and delay > SLOW_DELAY_DAYS:
        return ("slow",
                "%s schedule with delay_days=%d: working as configured, and far "
                "enough out to produce the same complaint" % (interval, delay))

    return ("scheduled", "%s schedule, delay_days=%s" % (interval, delay))


def get(session, path, account=None, **params):
    """GET one path. `account` sets the Stripe-Account header for per-account reads."""
    headers = {"Stripe-Account": account} if account else None
    r = session.get(API + path, params=params, headers=headers, timeout=30)
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


def stranded_facts(session, account_id):
    """Read the two facts that separate a deliberate manual schedule from a stuck one."""
    balance = get(session, "/balance", account=account_id)
    available = sum(b.get("amount", 0) for b in (balance.get("available") or []))
    payouts = get(session, "/payouts", account=account_id, limit=1)
    data = payouts.get("data") or []
    age = None
    if data and data[0].get("created"):
        age = (time.time() - data[0]["created"]) / 86400.0
    return available, age


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-accounts", type=int, default=5000,
                    help="stop paginating after this many accounts")
    ap.add_argument("--stale-days", type=float, default=STALE_DAYS,
                    help="a manual account with no payout this recently is stranded")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    counts = {}
    scanned = 0
    for acct in accounts(s, args.max_accounts):
        scanned += 1
        schedule = (((acct.get("settings") or {}).get("payouts") or {})
                    .get("schedule") or {})

        # Only spend the two extra GETs where the schedule says nobody is going
        # to create a payout on its own.
        available, age = (None, None)
        if schedule.get("interval") == "manual" and acct.get("payouts_enabled"):
            available, age = stranded_facts(s, acct.get("id", ""))

        state, detail = classify(acct, available, age)
        counts[state] = counts.get(state, 0) + 1
        if state in ("scheduled",):
            continue
        log.warning("%s  %-10s %s", acct.get("id", "acct_?"), state, detail)

    stranded = counts.get("stranded", 0)
    slow = counts.get("slow", 0)

    log.info("%d account(s): %d stranded, %d manual, %d slow",
             scanned, stranded, counts.get("manual", 0), slow)

    if stranded:
        log.warning("  repair, one of two, and pick deliberately:")
        log.warning("  POST %s/accounts/{id}  "
                    "settings[payouts][schedule][interval]=daily", API)
        log.warning("  or keep manual and write the job that creates "
                    "POST %s/payouts against each account", API)
        log.warning("  note: the first automatic payout releases the whole "
                    "accumulated balance at once. Warn the seller.")
    if slow:
        log.warning("  repair: lower settings[payouts][schedule][delay_days] to "
                    "the country minimum if it was inflated by accident")
    return 1 if stranded else 0


if __name__ == "__main__":
    sys.exit(main())
