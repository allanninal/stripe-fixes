"""Report connected accounts whose payout destination Stripe has stopped using.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Connected accounts, Bank accounts, Payouts and Balance. The repair is printed,
never performed, because this script holds a credential to a live payments
account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_external_account_errored")

API = "https://api.stripe.com/v1"

DAY = 86400

# Statuses where Stripe has stopped sending scheduled payouts to this
# destination. Same symptom, three different repairs, which is why the table is
# the check rather than a comparison against the one status everybody knows.
HALTED = {
    "errored":
        "a payout to this destination failed. Editing the account or routing "
        "number on the existing object does not clear this: attach a NEW external "
        "account and set default_for_currency on it.",
    "verification_failed":
        "the ownership details behind this destination could not be verified. "
        "Attach a new external account whose holder details match the account.",
    "tokenized_account_number_deactivated":
        "the tokenized account number behind this destination was deactivated. "
        "Re-link the bank through Financial Connections to mint a new one.",
}

# Statuses where payouts can be sent. `new` simply means Stripe has not yet had
# reason to validate it, which is not a problem.
HEALTHY = ("new", "validated", "verified")


def verdict(external, last_payout_created, available_amount, now):
    """Classify one external account. Pure. Returns (state, detail).

    `last_payout_created` and `available_amount` are the corroborating evidence
    and may be None, meaning it was not looked up. That is deliberate: the
    evidence is only fetched for destinations that already look halted, so the
    classifier has to be honest about the difference between "no money stranded"
    and "nobody checked".
    """
    if external is None:
        return ("no-destination",
                "no external account attached at all: there is nothing for a payout "
                "to be sent to")

    status = (external.get("status") or "").lower()

    if status in HALTED:
        bits = ["status %s" % status, HALTED[status]]
        if available_amount:
            bits.append("%d (minor units) sitting in the available balance"
                        % available_amount)
        if last_payout_created is not None:
            bits.append("last payout %d day(s) ago"
                        % ((now - last_payout_created) // DAY))
        elif available_amount is not None:
            bits.append("no payout has ever been attempted")
        if not external.get("default_for_currency"):
            bits.append("not the default destination for %s, so cleanup rather than "
                        "the cause" % (external.get("currency") or "its currency"))
        state = "stranded" if available_amount else "halted"
        return (state, " | ".join(bits))

    if status in HEALTHY:
        return ("healthy", "status %s: payouts can be sent here" % status)

    return ("unknown", "unrecognised status %r: read it before assuming it is fine"
            % (external.get("status"),))


def get(session, path, account=None, **params):
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


def evidence(session, account_id):
    """Balance and last payout for one account. Only called when it may matter."""
    balance = get(session, "/balance", account=account_id)
    available = sum(b.get("amount", 0) for b in balance.get("available", []) or [])
    payouts = get(session, "/payouts", account=account_id, limit=1)
    data = payouts.get("data", [])
    return (data[0].get("created") if data else None), available


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--account", help="check one connected account instead of all")
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

    if args.account:
        targets = [{"id": args.account}]
    else:
        targets = list(accounts(s, args.max_accounts))

    counts = {}
    destinations = 0

    for acct in targets:
        acct_id = acct.get("id")
        banks = get(s, "/accounts/%s/external_accounts" % acct_id,
                    object="bank_account", limit=100).get("data", [])
        if not banks:
            state, detail = verdict(None, None, None, now)
            counts[state] = counts.get(state, 0) + 1
            log.warning("%s  %-14s %s", acct_id, state, detail)
            continue

        for bank in banks:
            destinations += 1
            # The evidence costs two extra calls, so only spend them where the
            # status already says payouts have stopped.
            if (bank.get("status") or "").lower() in HALTED:
                last_payout, available = evidence(s, acct_id)
            else:
                last_payout, available = None, None
            state, detail = verdict(bank, last_payout, available, now)
            counts[state] = counts.get(state, 0) + 1
            if state == "healthy":
                continue
            log.warning("%s %s  %-14s %s", acct_id, bank.get("id", "ba_?"),
                        state, detail)

    halted = counts.get("halted", 0)
    stranded = counts.get("stranded", 0)
    log.info("%d account(s), %d destination(s): %d halted, %d stranded",
             len(targets), destinations, halted, stranded)

    if halted or stranded:
        log.warning("  repair: attach fresh details rather than editing the frozen "
                    "object, then make the new one default:")
        log.warning("  POST %s/accounts/{id} with external_account={{BANK_TOKEN}}", API)
        log.warning("  POST %s/accounts/{id}/external_accounts/{ba_id} with "
                    "default_for_currency=true", API)
        log.warning("  check: a flat count of failed payouts is not recovery when the "
                    "destination is frozen, because nothing is being attempted")
    if counts.get("no-destination"):
        log.warning("  %d account(s) have no bank account attached at all",
                    counts["no-destination"])
    return 1 if (halted or stranded or counts.get("no-destination")
                 or counts.get("unknown")) else 0


if __name__ == "__main__":
    sys.exit(main())
