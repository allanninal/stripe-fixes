"""Report connected accounts whose transfers capability is not active.

Read only. Paginated GETs and no writes: give this a RESTRICTED key with read
access to Connected accounts. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_transfers_capability")

API = "https://api.stripe.com/v1"

# Reasons no amount of field collection will clear. An onboarding link sent to an
# account in one of these states produces a completed form and no status change.
DASHBOARD_ONLY = ("listed", "under_review", "rejected")


def classify(capability):
    """Sort the transfers capability of one account. Pure, so the states can be
    tested without a network.

    `capability` is the object from GET /v1/accounts/{id}/capabilities/transfers,
    or None when the account's `capabilities` hash has no `transfers` key at all.
    That absence is its own state: the capability was never requested, so no
    requirement is outstanding and none ever will be.

    Returns (state, detail).
    """
    if capability is None:
        return ("unrequested",
                "no transfers capability on the account: it was never requested, "
                "so Stripe is not asking for anything and funds will never move")

    status = capability.get("status")
    reqs = capability.get("requirements") or {}
    due = [f for f in (reqs.get("currently_due") or []) if f]
    verifying = [f for f in (reqs.get("pending_verification") or []) if f]
    reason = reqs.get("disabled_reason")

    if status == "active":
        return ("active", "transfers are active")

    if status == "unrequested":
        return ("unrequested",
                "status unrequested: request the capability before collecting "
                "anything, because nothing is outstanding yet")

    if status == "pending":
        return ("verifying",
                "status pending: Stripe is checking what it already has%s. "
                "Collecting more fields does not speed it up"
                % (", %d field(s) in pending_verification" % len(verifying)
                   if verifying else ""))

    if status == "inactive":
        if due:
            return ("blocked",
                    "status inactive, %d field(s) currently due on this "
                    "capability: %s" % (len(due), ", ".join(due[:4])))
        if verifying:
            return ("verifying",
                    "status inactive with %d field(s) in pending_verification: "
                    "submitted and being checked, nothing to collect"
                    % len(verifying))
        if reason and (reason in DASHBOARD_ONLY
                       or reason.split(".", 1)[0] == "rejected"):
            return ("held",
                    "status inactive, disabled_reason %s: no API call clears "
                    "this one" % reason)
        if reason:
            return ("blocked",
                    "status inactive, disabled_reason %s with nothing currently "
                    "due: read every capability before collecting" % reason)
        return ("unknown",
                "status inactive with no currently_due and no disabled_reason")

    return ("unknown", "unrecognised capability status: %s" % status)


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
    ap.add_argument("--quiet-unrequested", action="store_true",
                    help="do not list accounts that never requested the capability")
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
        caps = acct.get("capabilities") or {}

        # The list response carries the status and nothing else. Only fetch the
        # capability object where the status is not already active, because that
        # object is the only place the reason lives.
        capability = None
        if caps.get("transfers") == "active":
            counts["active"] = counts.get("active", 0) + 1
            continue
        if "transfers" in caps:
            capability = get(s, "/accounts/%s/capabilities/transfers"
                             % acct.get("id", ""))

        state, detail = classify(capability)
        counts[state] = counts.get(state, 0) + 1
        if state == "unrequested" and args.quiet_unrequested:
            continue
        log.warning("%s  %-12s %s", acct.get("id", "acct_?"), state, detail)

    blocked = counts.get("blocked", 0)
    held = counts.get("held", 0)
    unrequested = counts.get("unrequested", 0)
    unknown = counts.get("unknown", 0)

    log.info("%d account(s): %d active, %d blocked, %d unrequested, %d held",
             scanned, counts.get("active", 0), blocked, unrequested, held)

    if unrequested:
        log.warning("  repair: request the capability first, then onboard for "
                    "whatever it asks for once Stripe starts asking:")
        log.warning("  POST %s/accounts/{id}/capabilities/transfers  requested=true",
                    API)
    if blocked:
        log.warning("  repair: read every capability and collect the union of "
                    "currently_due, since card_payments and transfers disable "
                    "each other:")
        log.warning("  GET %s/accounts/{id}/capabilities", API)
        log.warning("  then POST %s/accounts/{id} with those fields, or an "
                    "account link with type=account_onboarding", API)
    if held:
        log.warning("  repair: Dashboard, Connected accounts. No field collection "
                    "clears a rejected.* or under_review reason.")
    return 1 if (blocked or held or unrequested or unknown) else 0


if __name__ == "__main__":
    sys.exit(main())
