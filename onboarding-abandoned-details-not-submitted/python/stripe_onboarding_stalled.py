"""Report connected accounts that never finished onboarding.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to Connected accounts. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_onboarding_stalled")

API = "https://api.stripe.com/v1"

STALE_DAYS = 7   # below this, the seller may simply still be signing up
NEARLY_DONE = 3  # few enough fields left that the session probably died near the end


def classify(account, age_days, stale_days=STALE_DAYS):
    """Sort one connected account by how far its onboarding got. Pure, so the age
    threshold and the never-started split can be tested without a clock.

    `age_days` is the account's age in days, or None when `created` is missing.
    The length of currently_due is a triage heuristic and nothing more: Stripe
    does not publish a "how far through the form" field, and a short list is the
    closest honest proxy for a session that ended near the end.

    Returns (state, detail).
    """
    reqs = account.get("requirements") or {}
    due = [f for f in (reqs.get("currently_due") or []) if f]

    if account.get("details_submitted"):
        return ("submitted", "details_submitted is true: onboarding completed")

    if age_days is None:
        return ("unknown", "details_submitted is false and there is no created "
                           "timestamp to age it against")

    if age_days < stale_days:
        return ("in-flight",
                "%.1f days old and not submitted: may still be signing up, so do "
                "not chase it yet" % age_days)

    if not due:
        return ("unknown",
                "%.0f days old, not submitted, and nothing is currently due: no "
                "capability has been requested, so Stripe is not asking for "
                "anything" % age_days)

    if len(due) <= NEARLY_DONE:
        return ("abandoned-late",
                "%.0f days old with %d field(s) left (%s): got most of the way, "
                "then the session ended. Worth a fresh link and an email"
                % (age_days, len(due), ", ".join(due[:3])))

    return ("abandoned-cold",
            "%.0f days old with %d field(s) still due: the form was never worked "
            "through" % (age_days, len(due)))


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
    ap.add_argument("--stale-days", type=float, default=STALE_DAYS,
                    help="an unsubmitted account older than this is abandoned")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = time.time()
    counts = {}
    scanned = 0
    for acct in accounts(s, args.max_accounts):
        scanned += 1
        created = acct.get("created")
        age = None if created is None else (now - created) / 86400.0
        state, detail = classify(acct, age, args.stale_days)
        counts[state] = counts.get(state, 0) + 1
        if state in ("submitted", "in-flight"):
            continue
        log.warning("%s  %-15s %s", acct.get("id", "acct_?"), state, detail)

    late = counts.get("abandoned-late", 0)
    cold = counts.get("abandoned-cold", 0)

    log.info("%d account(s): %d in flight, %d abandoned",
             scanned, counts.get("in-flight", 0), late + cold)

    if late or cold:
        log.warning("  repair, in this order:")
        log.warning("  1. make refresh_url mint a new link and 302 to it. Stripe "
                    "sends the user there precisely when the old one is spent:")
        log.warning("  POST %s/account_links  account, refresh_url, return_url, "
                    "type=account_onboarding", API)
        log.warning("  2. never email or SMS the returned url. It is single use, "
                    "and a client fetching a preview of it uses it.")
        log.warning("  3. re-onboard the %d account(s) above with fresh links, "
                    "starting with the %d that nearly finished.", late + cold, late)
    return 1 if (late or cold) else 0


if __name__ == "__main__":
    sys.exit(main())
