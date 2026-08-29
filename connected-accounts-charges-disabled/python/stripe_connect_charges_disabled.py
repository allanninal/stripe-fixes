"""Report connected accounts that cannot take payments, and say who can fix each.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Connected accounts. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_connect_charges_disabled")

API = "https://api.stripe.com/v1"

# Reasons the API cannot clear. An onboarding link sent to one of these produces a
# completed form and no change in status, which reads as a broken link to the
# seller and as a fixed account to whoever sent it.
DASHBOARD_ONLY = ("listed", "under_review", "rejected")

# Stripe is holding the account while it checks something. There is no field to
# collect and nothing for anyone to do.
WAITING = ("requirements.pending_verification",)


def classify(account):
    """Sort one connected account. Pure, so the reason table can be tested.

    Takes an /v1/accounts object. Returns (state, detail). The states exist to
    split the work by who can do it: `blocked` is an email, `rejected` is a human
    in the Dashboard, `waiting` is nobody.
    """
    reqs = account.get("requirements") or {}
    reason = reqs.get("disabled_reason")
    due = [f for f in (reqs.get("currently_due") or []) if f]

    if account.get("charges_enabled"):
        return ("live", "charges_enabled, nothing to chase")

    if not account.get("details_submitted"):
        return ("never-onboarded",
                "details_submitted is false: this account never opened, so it has "
                "not broken. Do not page anyone about it.")

    if reason and (reason in DASHBOARD_ONLY or reason.split(".", 1)[0] == "rejected"):
        return ("rejected",
                "disabled_reason %s: the API cannot clear this. It is resolved from "
                "the Dashboard Connected accounts page, or not at all." % reason)

    if reason in WAITING:
        return ("waiting",
                "disabled_reason %s: Stripe is verifying what it already has. "
                "Collecting more fields does not speed it up." % reason)

    if due:
        return ("blocked",
                "%s, %d field(s) currently due: %s"
                % (reason or "no disabled_reason", len(due), ", ".join(due[:4])))

    if reason:
        return ("blocked",
                "%s with nothing in currently_due: read the per-capability "
                "requirements before collecting anything." % reason)

    return ("unknown",
            "charges_enabled is false with no disabled_reason and no currently_due")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
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


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-accounts", type=int, default=5000,
                    help="stop paginating after this many accounts")
    ap.add_argument("--quiet-never-onboarded", action="store_true",
                    help="do not list accounts that never finished onboarding")
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
        state, detail = classify(acct)
        counts[state] = counts.get(state, 0) + 1
        if state == "live":
            continue
        if state == "never-onboarded" and args.quiet_never_onboarded:
            continue
        log.warning("%s  %-16s %s", acct.get("id", "acct_?"), state, detail)

    blocked = counts.get("blocked", 0)
    rejected = counts.get("rejected", 0)
    unknown = counts.get("unknown", 0)

    log.info("%d account(s): %d blocked, %d rejected, %d never onboarded",
             scanned, blocked, rejected, counts.get("never-onboarded", 0))

    if blocked:
        log.warning("  repair: read the union of currently_due across every "
                    "capability first:")
        log.warning("  GET %s/accounts/{id}/capabilities", API)
        log.warning("  repair: create an account link for the seller, "
                    "type=account_onboarding, collection_options[fields]=currently_due")
    if rejected:
        log.warning("  repair: Dashboard, Connected accounts, open the account. "
                    "No API call clears a rejected.* or under_review reason.")
    if blocked or rejected or unknown:
        log.warning("  check: an endpoint with connect=true subscribed to "
                    "account.updated turns this into an event instead of a ticket")
    return 1 if (blocked or rejected or unknown) else 0


if __name__ == "__main__":
    sys.exit(main())
