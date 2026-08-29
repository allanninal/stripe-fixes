"""Find connected accounts whose balance cannot move because nothing is attached.

Read only. Two GETs per account and no writes: give this a RESTRICTED key with
read access to Connected accounts. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_missing_external_account")

API = "https://api.stripe.com/v1"

# A destination in one of these states is attached but cannot be paid to. It is a
# different problem from having none, and it needs fresh details rather than a
# form the seller has already filled in.
UNUSABLE = ("errored", "verification_failed",
            "tokenized_account_number_deactivated")


def classify(external_accounts, default_currency, currently_due=()):
    """Decide whether this account can be paid out. Pure, so it can be tested.

    `external_accounts` is the `data` array from /v1/accounts/{id}/external_accounts.
    Returns (state, detail).
    """
    rows = list(external_accounts or [])
    due = [f for f in (currently_due or []) if f]
    asked = "external_account" in due
    currency = (default_currency or "").lower()

    if not rows:
        if asked:
            return ("none",
                    "no external account, and external_account is in currently_due: "
                    "Stripe is asking and nobody is collecting it")
        return ("none-unrequested",
                "no external account and Stripe is not asking for one: external "
                "account collection was turned off during onboarding")

    unusable = [r for r in rows if r.get("status") in UNUSABLE]
    matching = [r for r in rows
                if (r.get("currency") or "").lower() == currency]
    default = [r for r in matching if r.get("default_for_currency")]

    if default:
        bad = [r for r in default if r.get("status") in UNUSABLE]
        if bad:
            return ("unusable",
                    "the default destination for %s has status %s: scheduled payouts "
                    "to it have stopped" % (currency or "?", bad[0].get("status")))
        return ("attached",
                "%d destination(s), default set for %s" % (len(rows), currency or "?"))

    if matching:
        return ("no-default",
                "%d destination(s) in %s but none marked default_for_currency: "
                "payouts have nowhere to go" % (len(matching), currency or "?"))

    if unusable:
        return ("unusable",
                "%d destination(s), all in a failed state (%s)"
                % (len(rows), unusable[0].get("status")))

    return ("wrong-currency",
            "%d destination(s), none of them in %s, so the balance cannot be paid out"
            % (len(rows), currency or "the account default currency"))


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
    ap.add_argument("--max-accounts", type=int, default=1000,
                    help="stop after this many accounts; each one costs a GET")
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
        acct_id = acct.get("id", "acct_?")
        reqs = acct.get("requirements") or {}
        page = get(s, "/accounts/%s/external_accounts" % acct_id, limit=100)
        state, detail = classify(page.get("data"), acct.get("default_currency"),
                                 reqs.get("currently_due"))
        counts[state] = counts.get(state, 0) + 1
        if state == "attached":
            continue
        log.warning("%s  %-17s payouts_enabled=%s  %s",
                    acct_id, state, acct.get("payouts_enabled"), detail)

    missing = counts.get("none", 0) + counts.get("none-unrequested", 0)
    no_default = counts.get("no-default", 0) + counts.get("wrong-currency", 0)

    log.info("%d account(s): %d with no destination, %d with no default for their "
             "currency", scanned, missing, no_default)

    if counts.get("none"):
        log.warning("  repair: send the seller an account link of type account_update "
                    "so they attach a bank account themselves")
    if counts.get("none-unrequested"):
        log.warning("  repair: Dashboard, Settings, Connect, Payouts: re-enable "
                    "external account collection, or finish the flow that was going "
                    "to collect it in your own interface")
    if no_default:
        log.warning("  repair: mark one destination default_for_currency for the "
                    "account default_currency, or attach one in that currency")
    if counts.get("unusable"):
        log.warning("  repair: attach fresh details. Editing the numbers on an "
                    "errored destination does not clear the status.")
    if missing or no_default or counts.get("unusable"):
        log.warning("  check: the balance on these accounts says how old this is:")
        log.warning("  GET %s/balance  with the Stripe-Account header", API)
    return 1 if (missing or no_default or counts.get("unusable")) else 0


if __name__ == "__main__":
    sys.exit(main())
