"""Report payouts that cannot be tied back to their balance transactions.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Payouts and Balance transactions. The repair is printed, never
performed, because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_payout_reconciliation")

API = "https://api.stripe.com/v1"

DAY = 86400


def classify(payout, txn_sum, txn_count):
    """Sort one payout by whether its contents can be recovered. Pure, so the
    states can be tested without a network.

    `txn_sum` is the sum of `net` over the balance transactions listed against
    this payout, or None when they were not fetched. `txn_count` is how many
    there were. Only payouts with reconciliation_status "completed" can be
    listed against at all, so for the rest both arguments are meaningless.

    Returns (state, detail).
    """
    status = payout.get("reconciliation_status")
    automatic = payout.get("automatic")
    amount = payout.get("amount")

    if status == "completed":
        if txn_sum is None:
            return ("reconcilable",
                    "reconciliation_status completed: the breakdown exists, this "
                    "run did not fetch it")
        if not isinstance(amount, int):
            return ("unknown", "payout has no numeric amount: %r" % (amount,))
        if txn_sum != amount:
            return ("mismatch",
                    "%d balance transaction(s) sum to %d against a payout amount "
                    "of %d, %d apart: look for another currency, a reversal in the "
                    "window, or a page you stopped paginating"
                    % (txn_count, txn_sum, amount, abs(amount - txn_sum)))
        return ("reconciled",
                "%d balance transaction(s) sum to the payout" % txn_count)

    if status == "in_progress":
        return ("pending",
                "reconciliation_status in_progress: Stripe is still assembling the "
                "breakdown, which fills in after the payout settles")

    if status == "not_applicable":
        if automatic is False:
            return ("manual",
                    "manual payout: reconciliation_status not_applicable, so no "
                    "balance transaction will ever list against it. The itemized "
                    "report is the only route to its contents")
        return ("unsupported",
                "reconciliation_status not_applicable on an automatic payout: "
                "Stripe itemises standard automatic payouts only")

    return ("unknown", "unrecognised reconciliation_status: %r" % (status,))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def payout_transactions(session, payout_id, cap):
    """Sum `net` over the balance transactions Stripe attributes to a payout."""
    total = 0
    count = 0
    params = {"payout": payout_id, "limit": 100}
    while True:
        page = get(session, "/balance_transactions", **params)
        data = page.get("data", [])
        for bt in data:
            total += bt.get("net") or 0
            count += 1
        if not data or not page.get("has_more") or count >= cap:
            return total, count
        params["starting_after"] = data[-1]["id"]


def orphan_charges(session, since):
    """Count charges created without a transfer_group, one page deep.

    Not the finding itself, but the reason a reconstruction is guesswork even
    where Stripe does hand you the payout breakdown.
    """
    page = get(session, "/charges", limit=100, **{"created[gte]": since})
    data = page.get("data", [])
    return sum(1 for c in data if not c.get("transfer_group")), len(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90, help="window to look at")
    ap.add_argument("--no-sums", action="store_true",
                    help="skip the per-payout balance transaction sums")
    ap.add_argument("--transfer-groups", action="store_true",
                    help="also count recent charges with no transfer_group")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * DAY
    counts = {}
    scanned = 0
    params = {"limit": 100, "created[gte]": since}
    while True:
        page = get(s, "/payouts", **params)
        data = page.get("data", [])
        for payout in data:
            scanned += 1
            txn_sum = txn_count = None
            if payout.get("reconciliation_status") == "completed" and not args.no_sums:
                txn_sum, txn_count = payout_transactions(s, payout["id"], 10000)
            state, detail = classify(payout, txn_sum, txn_count)
            counts[state] = counts.get(state, 0) + 1
            line = "%s  %-13s %s" % (payout.get("id", "po_?"), state, detail)
            (log.info if state in ("reconciled", "reconcilable", "pending")
             else log.warning)(line)
        if not data or not page.get("has_more"):
            break
        params["starting_after"] = data[-1]["id"]

    manual = counts.get("manual", 0)
    mismatched = counts.get("mismatch", 0)
    unsupported = counts.get("unsupported", 0)
    log.info("%d payout(s): %d manual, %d mismatched, %d unsupported",
             scanned, manual, mismatched, unsupported)

    if args.transfer_groups:
        orphans, sampled = orphan_charges(s, since)
        log.info("%d of %d recent charge(s) have no transfer_group", orphans, sampled)

    if manual or unsupported:
        log.warning("  repair: move the account to an automatic schedule so future "
                    "payouts are itemised:")
        log.warning("  POST %s/accounts/{id} with "
                    "settings[payouts][schedule][interval]=daily", API)
        log.warning("  for history, run the itemized report: POST "
                    "%s/reporting/report_runs with "
                    "report_type=payout_reconciliation.by_id.itemized.1", API)
    if mismatched:
        log.warning("  repair: the breakdown exists but does not add up. Check for "
                    "a second currency and for transfers with amount_reversed > 0 "
                    "in the same window.")
    return 1 if (manual or mismatched or unsupported or counts.get("unknown")) else 0


if __name__ == "__main__":
    sys.exit(main())
