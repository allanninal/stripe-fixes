"""Report Stripe cards saved with usage=on_session but billed off-session.

Read only. Three paginated GETs, no writes: give this a RESTRICTED key with read
access to SetupIntents, PaymentIntents and Subscriptions. The repair is printed,
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
log = logging.getLogger("stripe_setup_intent_usage")

API = "https://api.stripe.com/v1"


def verdict(succeeded, on_session, on_session_subscribed, auth_required):
    """Classify the account. Pure, so the ordering can be tested without a network.

    `on_session` counts saved cards recorded for customer-present reuse only.
    `on_session_subscribed` is the subset belonging to customers with an active
    subscription, which is the only subset that is unambiguously wrong.

    The decline count is deliberately checked second, not first: authentication
    failures with no on_session save behind them are a different bug, and reporting
    them here sends people to re-collect consent that was already correct.
    """
    if not succeeded:
        return ("unknown", "no succeeded SetupIntents in the window; nothing to judge")
    if on_session_subscribed and auth_required:
        return ("declining",
                "%d card(s) saved on_session belong to subscribed customers, and "
                "%d off-session charge(s) have already failed on "
                "authentication_required." % (on_session_subscribed, auth_required))
    if on_session_subscribed:
        return ("exposed",
                "%d card(s) saved on_session belong to customers with an active "
                "subscription. Nothing has failed yet; the next renewal is the "
                "test." % on_session_subscribed)
    if on_session:
        return ("review",
                "%d of %d saved card(s) used usage=on_session, none of them for a "
                "subscribed customer. Correct only if you never charge without the "
                "customer present." % (on_session, succeeded))
    if auth_required:
        return ("elsewhere",
                "%d off-session decline(s) on authentication_required, but every "
                "saved card is off_session. The mandate is not the cause; look at "
                "the charge path." % auth_required)
    return ("clear",
            "%d saved card(s), all off_session, 0 authentication_required decline(s)"
            % succeeded)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    seen = 0
    params = dict(params, limit=100)
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def subscribed_customer_ids(session, limit):
    ids = set()
    for sub in page_all(session, "/subscriptions", limit, status="active"):
        cus = sub.get("customer")
        if isinstance(cus, dict):
            cus = cus.get("id")
        if cus:
            ids.add(cus)
    return ids


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=180,
                    help="how far back to read SetupIntents and PaymentIntents")
    ap.add_argument("--max-intents", type=int, default=5000,
                    help="stop paginating each list after this many objects")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    subscribed = subscribed_customer_ids(s, 2000)

    succeeded = on_session = on_session_subscribed = 0
    offenders = []
    for si in page_all(s, "/setup_intents", args.max_intents,
                       **{"created[gte]": since}):
        if si.get("status") != "succeeded":
            continue
        succeeded += 1
        if si.get("usage") != "on_session":
            continue
        on_session += 1
        cus = si.get("customer")
        if isinstance(cus, dict):
            cus = cus.get("id")
        if cus in subscribed:
            on_session_subscribed += 1
            if len(offenders) < 10:
                offenders.append((si["id"], cus, si.get("mandate")))

    pi_on_session = auth_required = 0
    for pi in page_all(s, "/payment_intents", args.max_intents,
                       **{"created[gte]": since}):
        if pi.get("setup_future_usage") == "on_session":
            pi_on_session += 1
        err = pi.get("last_payment_error") or {}
        if err.get("decline_code") == "authentication_required":
            auth_required += 1

    state, detail = verdict(succeeded, on_session + pi_on_session,
                            on_session_subscribed, auth_required)

    line = "%-11s %s" % (state, detail)
    if state in ("clear", "unknown"):
        log.info(line)
        return 0

    log.warning(line)
    log.warning("  %d SetupIntent(s) and %d PaymentIntent(s) recorded on_session",
                on_session, pi_on_session)
    for si_id, cus, mandate in offenders:
        log.warning("  %s  customer=%s  mandate=%s", si_id, cus, mandate)
    log.warning("  repair: collect fresh consent, then save with the right usage")
    log.warning("  POST %s/setup_intents -d customer=cus_XXX -d usage=off_session", API)
    log.warning("  when saving during a payment: -d setup_future_usage=off_session")
    return 1


if __name__ == "__main__":
    sys.exit(main())
