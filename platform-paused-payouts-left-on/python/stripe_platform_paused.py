"""Report connected accounts the platform paused and never unpaused.

Read only. GETs only, no writes: give this a RESTRICTED key with read access to
Connected accounts and Payouts. The repair is printed, never performed, because
this script holds a credential to a live payments account. It is also printed as
a Dashboard path rather than an API call, because Stripe has no v1 endpoint that
unpauses an account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_platform_paused")

API = "https://api.stripe.com/v1"

DAY = 86400

PAUSED = "platform_paused"


def verdict(account, canceled_count, oldest_canceled_created, now):
    """Classify one connected account against a platform pause. Pure.

    Returns (state, detail). Accounts disabled for any other reason are returned
    as `other-reason` rather than being folded in: a pause is a decision your own
    team made and needs a different response from a missing verification field,
    and a check that blurs the two sends onboarding links to sellers who have
    nothing to submit.
    """
    reqs = account.get("requirements") or {}
    reason = reqs.get("disabled_reason")

    if reason == PAUSED:
        off = []
        if account.get("charges_enabled") is False:
            off.append("charges")
        if account.get("payouts_enabled") is False:
            off.append("payouts")
        bits = ["paused by the platform: %s off" % (" and ".join(off) or "nothing")]
        if canceled_count:
            bits.append("%d canceled payout(s)" % canceled_count)
        if oldest_canceled_created is not None:
            bits.append("paused for at least %d day(s), from the oldest cancellation"
                        % ((now - oldest_canceled_created) // DAY))
        bits.append("no API call reverses this: Dashboard, Connect, Connected "
                    "accounts, open the account")
        return ("paused", " | ".join(bits))

    if reason:
        return ("other-reason",
                "disabled for %s, which is not a platform pause and is not this "
                "check's problem" % reason)

    if canceled_count:
        return ("residue",
                "%d canceled payout(s) on an account that is not paused now: a pause "
                "was lifted and the canceled payouts were never re-issued" % canceled_count)

    return ("healthy", "not paused")


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


def canceled_payouts(session, account_id):
    """Count canceled payouts for one account and find the oldest.

    A pause holds in-flight payouts as pending for up to ten days and then
    cancels them, so this is the paper trail. Failed payouts are a different
    problem entirely and are not counted here.
    """
    count = 0
    oldest = None
    params = {"status": "canceled", "limit": 100}
    while True:
        page = get(session, "/payouts", account=account_id, **params)
        data = page.get("data", [])
        for payout in data:
            count += 1
            created = payout.get("created")
            if created is not None and (oldest is None or created < oldest):
                oldest = created
        if not data or not page.get("has_more"):
            return count, oldest
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check-canceled-everywhere", action="store_true",
                    help="look for canceled payouts on every account, not only the "
                         "paused ones. Two extra calls per account, and the only way "
                         "to find payouts canceled by a pause that was later lifted")
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

    counts = {}
    scanned = 0

    for acct in accounts(s, args.max_accounts):
        scanned += 1
        reqs = acct.get("requirements") or {}
        paused = reqs.get("disabled_reason") == PAUSED

        if paused or args.check_canceled_everywhere:
            count, oldest = canceled_payouts(s, acct.get("id"))
        else:
            count, oldest = 0, None

        state, detail = verdict(acct, count, oldest, now)
        counts[state] = counts.get(state, 0) + 1
        if state in ("healthy", "other-reason"):
            continue
        log.warning("%s  %-8s %s", acct.get("id", "acct_?"), state, detail)

    paused = counts.get("paused", 0)
    residue = counts.get("residue", 0)
    log.info("%d account(s): %d paused by the platform, %d with canceled payouts "
             "to re-issue", scanned, paused, residue)

    if paused:
        log.warning("  repair: Dashboard, Connect, Connected accounts, open the "
                    "account, unpause payments or payouts. There is no v1 API for it.")
        log.warning("  then: re-read the account and confirm payouts_enabled is true "
                    "and disabled_reason is gone")
        log.warning("  reconcile: every paused account should map to an OPEN "
                    "investigation. The ones that do not are the finding.")
    if paused or residue:
        log.warning("  note: unpausing does not replay canceled payouts. The balance "
                    "waits for the next scheduled payout, or forever on a manual "
                    "schedule.")
    if not args.check_canceled_everywhere:
        log.info("  canceled payouts were only checked on paused accounts; "
                 "--check-canceled-everywhere widens it")
    return 1 if (paused or residue) else 0


if __name__ == "__main__":
    sys.exit(main())
