"""Report Stripe balance currencies that no payout can drain.

Read only. Three GETs and no writes: give this a RESTRICTED key with read access
to Balance, Connected accounts and Payouts. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_stranded_currency")

API = "https://api.stripe.com/v1"

DAY = 86400


def classify(entry, pending, has_destination, payouts_seen):
    """Sort one currency of a Stripe balance. Pure, so the states can be tested
    without a network.

    `entry` is one element of balance.available. `pending` is the amount in the
    matching balance.pending entry. `has_destination` is whether any external
    account on this account holds that currency, and `payouts_seen` is how many
    payouts in that currency happened in the window.

    Returns (state, detail).
    """
    amount = entry.get("amount")
    if not isinstance(amount, int):
        return ("unknown", "available entry has no numeric amount: %r" % (amount,))

    if not has_destination:
        if amount > 0:
            return ("stranded",
                    "%d settled with no external account in this currency: no "
                    "automatic payout can target it, so it will sit here "
                    "indefinitely" % amount)
        if pending > 0:
            return ("accruing",
                    "%d still pending with no external account in this currency: "
                    "it becomes stranded when it settles" % pending)
        return ("clear", "no destination for this currency, but nothing is in it")

    if amount > 0 and not payouts_seen:
        return ("stalled",
                "%d settled and a destination exists, but no payout in this "
                "currency in the window: the external account is probably not "
                "default_for_currency" % amount)

    if amount > 0 or pending > 0:
        return ("draining",
                "destination present, %d payout(s) in the window" % payouts_seen)

    return ("clear", "empty bucket")


def get(session, path, headers=None, **params):
    r = session.get(API + path, params=params, headers=headers, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def payout_currencies(session, headers, since):
    """Count payouts per currency over the window."""
    counts = {}
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/payouts", headers=headers, **params)
        data = page.get("data", [])
        for p in data:
            cur = p.get("currency", "?")
            counts[cur] = counts.get(cur, 0) + 1
        if not data or not page.get("has_more"):
            return counts
        params["starting_after"] = data[-1]["id"]


def destination_currencies(session, headers, account_id):
    """Currencies that have somewhere to be paid out to."""
    out = set()
    params = {"limit": 100}
    while True:
        page = get(session, "/accounts/%s/external_accounts" % account_id,
                   headers=headers, **params)
        data = page.get("data", [])
        for ext in data:
            if ext.get("currency"):
                out.add(ext["currency"])
        if not data or not page.get("has_more"):
            return out
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--account", help="a connected account id to check instead of "
                                      "the account the key belongs to")
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to look for payouts in each currency")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})
    headers = {"Stripe-Account": args.account} if args.account else None

    since = int(time.time()) - args.days * DAY
    account_id = args.account or get(s, "/account").get("id", "")
    balance = get(s, "/balance", headers=headers)
    destinations = destination_currencies(s, headers, account_id)
    payouts = payout_currencies(s, headers, since)

    pending = {e.get("currency", "?"): e.get("amount") or 0
               for e in balance.get("pending", [])}
    available = balance.get("available", [])

    # Union both arrays: a currency can be entirely in pending, which is the
    # state worth catching because it is the one you can still act on early.
    currencies = {e.get("currency", "?") for e in available} | set(pending)

    counts = {}
    for cur in sorted(currencies):
        entry = next((e for e in available if e.get("currency") == cur),
                     {"currency": cur, "amount": 0})
        state, detail = classify(entry, pending.get(cur, 0),
                                 cur in destinations, payouts.get(cur, 0))
        counts[state] = counts.get(state, 0) + 1
        line = "%-4s %-10s %s" % (cur, state, detail)
        (log.info if state in ("clear", "draining") else log.warning)(line)

    stranded = counts.get("stranded", 0)
    accruing = counts.get("accruing", 0)
    stalled = counts.get("stalled", 0)
    log.info("%d bucket(s): %d stranded, %d accruing, %d stalled",
             len(currencies), stranded, accruing, stalled)

    if stranded or accruing:
        log.warning("  repair: add a destination in that currency and make it the "
                    "default, or stop accepting the currency:")
        log.warning("  POST %s/accounts/%s with external_account in the currency, "
                    "then default_for_currency=true", API, account_id or "{id}")
    if stalled:
        log.warning("  repair: a destination exists but is not being used. Check "
                    "default_for_currency on it before adding another one.")
    return 1 if (stranded or accruing or stalled or counts.get("unknown")) else 0


if __name__ == "__main__":
    sys.exit(main())
