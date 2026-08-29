"""Report platform funds held in connect_reserved against negative accounts.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Balance, Balance transactions and Connected accounts. The repair is
printed, never performed, because this script holds a credential to a live
payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_connect_reserve")

API = "https://api.stripe.com/v1"

DAY = 86400


def classify(entry, reserved, collected):
    """Sort one currency bucket of connect_reserved. Pure, so the states can be
    tested without a network.

    `entry` is one element of balance.connect_reserved. `reserved` is the total
    reserve_transaction activity seen in that currency over the window and
    `collected` the total connect_collection_transfer activity, both passed as
    magnitudes in minor units: the sign of a balance transaction depends on the
    direction of the movement, and only the size matters here.

    Returns (state, detail).
    """
    amount = entry.get("amount")
    if not isinstance(amount, int):
        return ("unknown", "connect_reserved entry has no numeric amount: %r" % (amount,))

    if collected:
        return ("written-off",
                "%d already moved out as connect_collection_transfer: accounts that "
                "stayed negative for 180 days were settled from your reserve, and "
                "that money is not coming back" % collected)

    if amount > 0 and reserved:
        return ("growing",
                "%d held now and %d of reserve_transaction activity in the window: "
                "accounts are still going negative faster than they earn back"
                % (amount, reserved))

    if amount > 0:
        return ("held",
                "%d held with no reserve_transaction activity in the window: the "
                "negative account behind it has stopped trading, so nothing will "
                "release this before the 180 day settlement" % amount)

    if reserved:
        return ("settled",
                "nothing held now, %d of reserve_transaction activity in the window: "
                "reserves were taken and released as accounts earned back" % reserved)

    return ("clear", "nothing reserved")


def get(session, path, headers=None, **params):
    r = session.get(API + path, params=params, headers=headers, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def totals_by_currency(session, btype, since, cap):
    """Sum balance transactions of one type per currency, as magnitudes."""
    totals = {}
    seen = 0
    params = {"type": btype, "limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/balance_transactions", **params)
        data = page.get("data", [])
        for bt in data:
            cur = bt.get("currency", "?")
            totals[cur] = totals.get(cur, 0) + abs(bt.get("amount") or 0)
            seen += 1
        if not data or not page.get("has_more") or seen >= cap:
            return totals
        params["starting_after"] = data[-1]["id"]


def negative_accounts(session, cap):
    """Yield (account_id, currency, amount, liable) for accounts below zero.

    One extra GET per connected account, which is why this is behind a flag.
    """
    params = {"limit": 100}
    seen = 0
    while True:
        page = get(session, "/accounts", **params)
        data = page.get("data", [])
        for acct in data:
            seen += 1
            aid = acct.get("id", "")
            controller = acct.get("controller") or {}
            losses = (controller.get("losses") or {}).get("payments")
            bal = get(session, "/balance", headers={"Stripe-Account": aid})
            for entry in bal.get("available", []):
                if (entry.get("amount") or 0) < 0:
                    yield (aid, entry.get("currency", "?"), entry["amount"],
                           losses == "application")
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="window for reserve and collection activity")
    ap.add_argument("--accounts", action="store_true",
                    help="also find the negative connected accounts (one GET each)")
    ap.add_argument("--max-accounts", type=int, default=1000,
                    help="stop the per-account pass after this many accounts")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * DAY
    balance = get(s, "/balance")
    reserved_now = balance.get("connect_reserved") or []
    if not reserved_now:
        log.info("no connect_reserved on this balance: either not a platform, or "
                 "no account has ever gone negative")

    reserved = totals_by_currency(s, "reserve_transaction", since, 5000)
    collected = totals_by_currency(s, "connect_collection_transfer", since, 5000)

    # A currency can have activity in the window and nothing held now, so union
    # the buckets rather than iterating connect_reserved alone.
    currencies = ({e.get("currency", "?") for e in reserved_now}
                  | set(reserved) | set(collected))

    counts = {}
    for cur in sorted(currencies):
        entry = next((e for e in reserved_now if e.get("currency") == cur),
                     {"currency": cur, "amount": 0})
        state, detail = classify(entry, reserved.get(cur, 0), collected.get(cur, 0))
        counts[state] = counts.get(state, 0) + 1
        line = "%-4s %-11s %s" % (cur, state, detail)
        (log.info if state in ("clear", "settled") else log.warning)(line)

    log.info("%d currency bucket(s): %d growing, %d held, %d written off",
             len(currencies), counts.get("growing", 0), counts.get("held", 0),
             counts.get("written-off", 0))

    if args.accounts:
        found = 0
        for aid, cur, amount, liable in negative_accounts(s, args.max_accounts):
            found += 1
            log.warning("%s  %s %d  liable=%s", aid, cur, amount, liable)
        if not found:
            log.info("no connected account is currently below zero")

    if counts.get("growing") or counts.get("held") or counts.get("written-off"):
        log.warning("  repair, per negative account, in order of preference:")
        log.warning("  1. transfer the shortfall to the account to release the "
                    "reserve now: %s/transfers with destination=acct_x", API)
        log.warning("  2. make future shortfalls come out of the account's own "
                    "bank: %s/balance_settings with Stripe-Account, "
                    "payments[debit_negative_balances]=true", API)
        log.warning("  3. for accounts that will never trade again, reject them "
                    "so nothing more accrues: %s/accounts/{id}/reject", API)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
