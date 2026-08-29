"""Report Issuing cardholders whose requirements keep their cards inactive.

Read only. Three GET requests and no writes: give this a RESTRICTED key with
read access to Issuing cardholders, Issuing cards and Issuing authorizations.
The repair is printed, never performed, because this script holds a credential
to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_issuing_cardholder_requirements")

API = "https://api.stripe.com/v1"

# Fields under this prefix record that the cardholder accepted the Authorized
# User Terms. They are past due far more often than any identity field, and they
# are not a verification problem: nothing needs checking, the terms were never
# shown.
TERMS_PREFIX = "individual.card_issuing.user_terms_acceptance"

# What each decline reason actually implies. Six reasons, six unrelated repairs,
# and all six arrive as approved: false with nothing else to tell them apart.
DECLINE_HINTS = {
    "card_inactive":
        "the card itself is not active. Activation is blocked while the cardholder "
        "has past-due requirements, so check the cardholder first.",
    "cardholder_inactive":
        "the cardholder is not active. Its own status, not the card's, is the block.",
    "verification_failed":
        "the cardholder's identity verification did not pass. Collecting the same "
        "details again will not change it; read the requirements for what failed.",
    "insufficient_funds":
        "the Issuing balance is empty, which has nothing to do with requirements. "
        "Read balance.issuing.available and top it up.",
    "spending_controls":
        "a spending control on the card or cardholder rejected this. The card is "
        "working exactly as configured.",
    "webhook_timeout":
        "your real-time authorization endpoint did not answer in time, so Stripe "
        "applied the default. This is your latency, not a cardholder problem.",
}


def explain_decline(reason):
    """Turn an authorization decline reason into its repair. Pure.

    Unknown reasons come back named rather than swallowed: the enum grows, and a
    decline reported as "unknown reason" is still more useful than one silently
    dropped from the tally.
    """
    if reason in DECLINE_HINTS:
        return DECLINE_HINTS[reason]
    return "unrecognised reason %r: read the authorization's request_history" % (reason,)


def verdict(cardholder, inactive_cards):
    """Classify one cardholder. Pure. Returns (state, detail).

    `inactive_cards` is how many of its cards are sitting inactive. The states
    separate three different jobs: capture a terms acceptance, collect identity
    fields, or go and find out why your own code never called activation.
    """
    reqs = cardholder.get("requirements") or {}
    past_due = [f for f in (reqs.get("past_due") or []) if f]
    reason = reqs.get("disabled_reason")
    cards = " (%d inactive card(s) behind it)" % inactive_cards if inactive_cards else ""

    if past_due:
        if all(f.startswith(TERMS_PREFIX) for f in past_due):
            return ("blocked-terms",
                    "past_due is only terms acceptance: %s%s. Nothing needs "
                    "verifying. Capture the IP and the timestamp at the moment the "
                    "cardholder accepts the Authorized User Terms."
                    % (", ".join(past_due), cards))
        return ("blocked-identity",
                "%d field(s) past due: %s%s. Activation stays blocked until every "
                "one is supplied." % (len(past_due), ", ".join(past_due[:4]), cards))

    if reason:
        return ("disabled",
                "disabled_reason %s with nothing in past_due%s: read the "
                "requirements hash before collecting anything" % (reason, cards))

    if cardholder.get("status") != "active":
        return ("inactive-cardholder",
                "status %r with no outstanding requirements%s: this was set "
                "deliberately, so find out by whom"
                % (cardholder.get("status"), cards))

    if inactive_cards:
        return ("dormant",
                "cardholder is clean and %d card(s) are still inactive: nothing is "
                "blocking activation, so nobody ever called it" % inactive_cards)

    return ("healthy", "active, nothing past due")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def paginate(session, path, cap, **params):
    """Yield every object from a list endpoint, up to `cap`."""
    seen = 0
    params = dict(params, limit=100)
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for item in data:
            yield item
            seen += 1
            if seen >= cap:
                return
        if not data or not page.get("has_more"):
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-authorizations", type=int, default=1000,
                    help="how many recent authorizations to read for decline reasons")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    inactive = {}
    total_inactive = 0
    for card in paginate(s, "/issuing/cards", 5000, status="inactive"):
        total_inactive += 1
        holder = (card.get("cardholder") or {}).get("id")
        if holder:
            inactive[holder] = inactive.get(holder, 0) + 1

    counts = {}
    cardholders = 0
    for holder in paginate(s, "/issuing/cardholders", 5000):
        cardholders += 1
        state, detail = verdict(holder, inactive.get(holder.get("id"), 0))
        counts[state] = counts.get(state, 0) + 1
        if state == "healthy":
            continue
        log.warning("%s  %-18s %s", holder.get("id", "ich_?"), state, detail)

    reasons = {}
    for auth in paginate(s, "/issuing/authorizations", args.max_authorizations):
        if auth.get("approved"):
            continue
        for attempt in auth.get("request_history") or []:
            reason = attempt.get("reason")
            reasons[reason] = reasons.get(reason, 0) + 1

    blocked = counts.get("blocked-terms", 0) + counts.get("blocked-identity", 0)
    log.info("%d cardholder(s), %d inactive card(s): %d blocked, %d dormant",
             cardholders, total_inactive, blocked, counts.get("dormant", 0))

    for reason, count in sorted(reasons.items(), key=lambda kv: -kv[1]):
        log.warning("  %d decline(s) with reason %s: %s",
                    count, reason, explain_decline(reason))

    if counts.get("blocked-terms"):
        log.warning("  repair: POST %s/issuing/cardholders/{ich_id} with", API)
        log.warning("  individual[card_issuing][user_terms_acceptance][date] and [ip], "
                    "captured when the cardholder accepted the terms")
    if counts.get("blocked-identity"):
        log.warning("  repair: POST %s/issuing/cardholders/{ich_id} supplying every "
                    "field listed in requirements.past_due", API)
    if blocked or counts.get("dormant"):
        log.warning("  then: POST %s/issuing/cards/{ic_id} with status=active. "
                    "Activation before the requirements clear does not stick.", API)
    return 1 if (blocked or counts.get("dormant") or counts.get("disabled")
                 or counts.get("inactive-cardholder")) else 0


if __name__ == "__main__":
    sys.exit(main())
