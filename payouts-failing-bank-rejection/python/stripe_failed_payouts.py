"""Group failed Stripe payouts by failure_code and say what each one needs.

Read only. One paginated GET per account and no writes: give this a RESTRICTED
key with read access to Payouts. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_failed_payouts")

API = "https://api.stripe.com/v1"

# The destination is wrong or gone. Nothing but new bank details fixes these.
NEW_DETAILS = (
    "account_closed", "no_account", "invalid_account_number",
    "invalid_account_number_length", "incorrect_account_holder_name",
    "incorrect_account_holder_address", "incorrect_account_holder_tax_id",
    "unsupported_card",
)
# The account exists but its holder has to authorise something with their bank.
BANK_AUTHORISATION = (
    "debit_not_authorized", "incorrect_account_type", "declined",
    "bank_account_restricted", "account_frozen",
)
# Your balance, not their bank.
FUNDING = ("insufficient_funds",)
# Transient. Worth one retry before anyone is contacted.
TRANSIENT = ("could_not_process", "bank_ownership_changed")
# A configuration mismatch on the destination rather than a bad number.
CONFIGURATION = ("invalid_currency", "unsupported_currency")


def classify(payout):
    """Sort one payout by what its failure needs. Pure, so the table is testable.

    Takes a /v1/payouts object. Returns (state, detail). The states name the
    person who can act, which is the only grouping that changes what you do next.
    """
    status = payout.get("status")
    if status in ("paid", "in_transit", "pending"):
        return ("open", "status %s: not a failure, and not final either" % status)
    if status == "canceled":
        return ("canceled", "cancelled before it left, nothing was rejected")
    if status != "failed":
        return ("unknown", "unrecognised status %r" % (status,))

    code = payout.get("failure_code") or "unknown"
    message = payout.get("failure_message") or "no failure_message"
    returned = payout.get("failure_balance_transaction") is not None
    tail = "" if returned else " (no failure_balance_transaction: check the balance)"

    if code in NEW_DETAILS:
        return ("new-details",
                "%s: the destination is gone or wrong. Attach a fresh external "
                "account; re-entering the same number fails identically.%s"
                % (code, tail))
    if code in BANK_AUTHORISATION:
        return ("bank-authorisation",
                "%s: the account exists, its holder has to settle this with their "
                "bank. New details will not help.%s" % (code, tail))
    if code in FUNDING:
        return ("funding",
                "%s: your balance could not cover it. This is your side, not "
                "theirs.%s" % (code, tail))
    if code in TRANSIENT:
        return ("transient",
                "%s: worth one retry before anyone is contacted.%s" % (code, tail))
    if code in CONFIGURATION:
        return ("configuration",
                "%s: the destination cannot receive this currency.%s" % (code, tail))
    return ("unclassified",
            "failure_code %s: %s%s" % (code, message, tail))


def get(session, path, account=None, **params):
    headers = {"Stripe-Account": account} if account else None
    r = session.get(API + path, params=params, headers=headers, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def failed_payouts(session, since, cap, account=None):
    """Yield failed payouts created since `since`, paginating to the cap."""
    seen = 0
    params = {"limit": 100, "status": "failed", "created[gte]": since}
    while True:
        page = get(session, "/payouts", account=account, **params)
        data = page.get("data", [])
        for po in data:
            yield po
            seen += 1
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=90,
                    help="how far back to look (default 90)")
    ap.add_argument("--account", action="append", default=[],
                    help="also scan this connected account; repeatable")
    ap.add_argument("--max-payouts", type=int, default=2000,
                    help="stop paginating after this many failed payouts")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    counts = {}
    by_code = {}
    returned_minor = 0
    total = 0

    for account in [None] + list(args.account):
        for po in failed_payouts(s, since, args.max_payouts, account):
            total += 1
            state, detail = classify(po)
            counts[state] = counts.get(state, 0) + 1
            code = po.get("failure_code") or "unknown"
            by_code[code] = by_code.get(code, 0) + 1
            returned_minor += int(po.get("amount") or 0)
            log.warning("%s  %-18s dest=%s  %s", po.get("id", "po_?"), state,
                        po.get("destination") or "?", detail)

    log.info("%d failed payout(s) in the last %d days", total, args.days)
    for code, n in sorted(by_code.items(), key=lambda kv: -kv[1]):
        log.warning("  %-34s %d", code, n)

    if total:
        log.warning("  %d in minor units came back to the balance: reconcile against "
                    "failure_balance_transaction or it is counted twice", returned_minor)
    if counts.get("new-details"):
        log.warning("  repair: attach a new external account and make it the default "
                    "for the currency. Editing the existing one rarely clears it.")
    if counts.get("bank-authorisation"):
        log.warning("  repair: the account holder authorises credits and debits with "
                    "their own bank. No API call substitutes for that.")
    if counts.get("funding"):
        log.warning("  repair: fund the balance before the next payout cycle")
    if total:
        log.warning("  check: the destination status is probably errored, which stops "
                    "scheduled payouts and is why the failures are not accumulating:")
        log.warning("  GET %s/accounts/{id}/external_accounts", API)
        log.warning("  check: payout.failed in enabled_events, or this stays a "
                    "five day old surprise:")
        log.warning("  GET %s/webhook_endpoints", API)
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
