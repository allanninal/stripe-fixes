"""Report destination charges that carry no application fee.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Charges, Application fees and Balance transactions. The repair is
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
log = logging.getLogger("stripe_application_fees")

API = "https://api.stripe.com/v1"

DAY = 86400


def classify(fee_count, dest_total, dest_with_fee, dest_implicit):
    """Sort a platform's fee collection over one window. Pure, so the states can
    be tested without a network.

    `fee_count` is how many ApplicationFee objects exist in the window.
    `dest_total` is how many charges had transfer_data.destination set,
    `dest_with_fee` how many of those carried application_fee_amount, and
    `dest_implicit` how many instead under-transferred with transfer_data.amount,
    which keeps money on the platform without ever creating a fee object.

    Returns (state, detail).
    """
    counts = (fee_count, dest_total, dest_with_fee, dest_implicit)
    if any(not isinstance(c, int) or c < 0 for c in counts):
        return ("unknown", "counts must be non-negative integers: %r" % (counts,))
    if dest_with_fee + dest_implicit > dest_total:
        return ("unknown",
                "%d charges with a fee and %d implicit against only %d destination "
                "charges: the counts do not agree"
                % (dest_with_fee, dest_implicit, dest_total))

    if dest_total == 0:
        return ("idle",
                "no destination charges in the window, so there is nothing here "
                "that could carry an application fee")

    if fee_count == 0 and dest_implicit and not dest_with_fee:
        return ("invisible",
                "%d of %d destination charge(s) keep money on the platform via "
                "transfer_data[amount] and no ApplicationFee object exists: the "
                "revenue is real but every fee report will read zero"
                % (dest_implicit, dest_total))

    if fee_count == 0:
        return ("zero",
                "%d destination charge(s), none with application_fee_amount: the "
                "full amount went to the connected account every time"
                % dest_total)

    missing = dest_total - dest_with_fee - dest_implicit
    if missing > 0:
        return ("partial",
                "%d of %d destination charge(s) carry no fee at all: one code path "
                "that creates charges is not passing application_fee_amount"
                % (missing, dest_total))

    if dest_implicit:
        return ("mixed",
                "%d charge(s) take the fee explicitly and %d take it implicitly "
                "through transfer_data[amount]: the implicit ones never appear in "
                "/v1/application_fees" % (dest_with_fee, dest_implicit))

    return ("collecting",
            "%d destination charge(s), %d with application_fee_amount"
            % (dest_total, dest_with_fee))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def count_pages(session, path, since, cap, on_item=None):
    """Paginate a created[gte] list, optionally inspecting each item."""
    seen = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for item in data:
            seen += 1
            if on_item:
                on_item(item)
        if not data or not page.get("has_more") or seen >= cap:
            return seen
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30, help="window to look at")
    ap.add_argument("--max-charges", type=int, default=5000,
                    help="stop paginating charges after this many")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * DAY

    fee_count = count_pages(s, "/application_fees", since, 5000)

    tally = {"dest": 0, "fee": 0, "implicit": 0}
    destinations = set()

    def inspect(charge):
        transfer = charge.get("transfer_data") or {}
        dest = transfer.get("destination")
        if not dest:
            return
        tally["dest"] += 1
        destinations.add(dest if isinstance(dest, str) else dest.get("id", "?"))
        if charge.get("application_fee_amount") is not None:
            tally["fee"] += 1
        elif (transfer.get("amount") is not None
              and transfer["amount"] < (charge.get("amount") or 0)):
            tally["implicit"] += 1

    count_pages(s, "/charges", since, args.max_charges, inspect)

    state, detail = classify(fee_count, tally["dest"], tally["fee"],
                             tally["implicit"])
    (log.info if state in ("collecting", "idle") else log.warning)(
        "%-11s %s", state, detail)
    log.info("%d application fee object(s) in the window", fee_count)

    # The fee list and the application_fee balance transactions should agree.
    # Fees that exist as objects but never as balance transactions were
    # collected and then refunded, which is a different problem from this one.
    bt_page = get(s, "/balance_transactions", limit=100, type="application_fee",
                  **{"created[gte]": since})
    if fee_count and not bt_page.get("data"):
        log.warning("fee objects exist but no application_fee balance transaction "
                    "in the window: the fees were taken and refunded back out")

    if state in ("zero", "invisible", "partial", "mixed"):
        log.warning("  repair: pass application_fee_amount in minor units on every "
                    "call that creates a charge with transfer_data[destination], "
                    "including subscriptions and invoices.")
        log.warning("  check first, on each destination: GET %s/accounts/{id} and "
                    "confirm capabilities.transfers is active, because a fee on an "
                    "account without it fails the whole charge.", API)
        log.warning("  %d destination account(s) seen in this window", len(destinations))
        return 1
    return 1 if state == "unknown" else 0


if __name__ == "__main__":
    sys.exit(main())
