"""Report Stripe PaymentIntents that were created and never confirmed.

Read only. One paginated GET, no writes: give this a RESTRICTED key with read
access to PaymentIntents. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_stale_intents")

API = "https://api.stripe.com/v1"
STALE_SECONDS = 7 * 86400
OPEN_STATUSES = ("requires_payment_method", "requires_confirmation")


def classify(intent, now, stale_after=STALE_SECONDS):
    """Classify one PaymentIntent. Pure, so the rules can be tested without a network.

    Returns (state, detail). The split that matters is `last_payment_error`:
    null means nothing was ever attempted, populated means the customer tried and
    was declined. The two look identical in a status count and need opposite fixes.
    """
    status = intent.get("status")
    if status not in OPEN_STATUSES:
        return ("other", "status %r, not an open intent" % (status,))
    created = intent.get("created")
    if not isinstance(created, int):
        return ("unknown", "no created timestamp, so the intent cannot be aged")
    days = int((now - created) // 86400)
    if now - created < stale_after:
        return ("recent", "%s, %dd old, still plausibly live" % (status, days))
    if status == "requires_confirmation":
        return ("unconfirmed",
                "%dd old: confirmation_method is manual and the server never "
                "called confirm" % days)
    err = intent.get("last_payment_error") or {}
    if err:
        reason = err.get("decline_code") or err.get("code") or "no code given"
        return ("declined",
                "%dd old: last attempt was declined (%s) and nothing offered a retry"
                % (days, reason))
    return ("never-attempted",
            "%dd old: created but no payment method was ever attached" % days)


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def payment_intents(session, since, until, cap):
    """Yield PaymentIntents created in [since, until), up to `cap` of them."""
    seen = 0
    params = {"limit": 100, "created[gte]": since, "created[lt]": until}
    while True:
        page = get(session, "/payment_intents", **params)
        data = page.get("data", [])
        for pi in data:
            yield pi
            seen += 1
            if seen >= cap:
                return
        if not page.get("has_more") or not data:
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to scan (default 30)")
    ap.add_argument("--stale-days", type=int, default=7,
                    help="age at which an open intent counts as stale")
    ap.add_argument("--max-intents", type=int, default=5000,
                    help="stop paginating after this many intents")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    now = int(time.time())
    stale_after = args.stale_days * 86400
    since = now - args.days * 86400
    until = now - stale_after  # only intents old enough to have a verdict

    counts = {}
    codes = {}
    examples = []
    scanned = 0

    for pi in payment_intents(s, since, until, args.max_intents):
        scanned += 1
        state, detail = classify(pi, now, stale_after)
        counts[state] = counts.get(state, 0) + 1
        if state == "declined":
            err = pi.get("last_payment_error") or {}
            code = err.get("decline_code") or err.get("code") or "unknown"
            codes[code] = codes.get(code, 0) + 1
        if state in ("never-attempted", "declined", "unconfirmed") and len(examples) < 10:
            examples.append((pi["id"], detail))

    never = counts.get("never-attempted", 0)
    declined = counts.get("declined", 0)
    unconfirmed = counts.get("unconfirmed", 0)
    stale = never + declined + unconfirmed

    for pid, detail in examples:
        log.warning("%s  %s", pid, detail)

    share = (100.0 * stale / scanned) if scanned else 0.0
    log.info("%d intent(s) older than %dd: %d stale (%.0f%%) - "
             "%d never-attempted, %d declined, %d unconfirmed",
             scanned, args.stale_days, stale, share, never, declined, unconfirmed)

    for code, n in sorted(codes.items(), key=lambda kv: -kv[1]):
        log.warning("  decline %-28s %d", code, n)

    if share > 30:
        log.warning("  over 30%% of intents in this window never went anywhere")
    if never:
        log.warning("  repair: create the PaymentIntent when the customer submits, "
                    "not when the payment page renders")
    if declined:
        log.warning("  repair: retry on the same intent and show "
                    "last_payment_error.message rather than a generic failure")
    if unconfirmed:
        log.warning("  repair: find the job that owes Stripe "
                    "POST %s/payment_intents/{id}/confirm and fix it", API)
    if stale:
        log.warning("  to clear the backlog: POST %s/payment_intents/{id}/cancel "
                    "-d cancellation_reason=abandoned", API)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
