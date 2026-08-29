"""Report Stripe SetupIntents that were created and never confirmed.

Read only. One paginated GET and no writes: give this a RESTRICTED key with read
access to SetupIntents. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_setup_intents_stuck")

API = "https://api.stripe.com/v1"

STUCK_STATUSES = ("requires_payment_method", "requires_confirmation", "requires_action")
BROKEN_RATIO = 0.20   # above this, it is the confirm path rather than abandonment
MIN_AGE_HOURS = 24    # younger than this is a customer still typing


def verdict(total, requires_payment_method, requires_confirmation, requires_action):
    """Classify a window of SetupIntents. Pure, so it can be tested offline.

    Ties are broken in a fixed order rather than by whichever bucket a dict
    happened to yield first: requires_action wins, then requires_confirmation.
    Both are specific code defects, while requires_payment_method is the bucket
    ordinary abandonment also lands in, so it is the least informative of the
    three and should never win a tie.

    Returns (state, detail).
    """
    stuck = requires_payment_method + requires_confirmation + requires_action
    if not total:
        return ("clear", "no SetupIntents created in the window")
    if not stuck:
        return ("clear", "all %d SetupIntent(s) in the window resolved" % total)
    ratio = stuck / float(total)
    pct = ratio * 100
    if ratio < BROKEN_RATIO:
        return ("abandonment",
                "%d of %d SetupIntents (%.0f%%) are stuck, under the %.0f%% that "
                "separates a broken confirm path from ordinary drop-off"
                % (stuck, total, pct, BROKEN_RATIO * 100))
    if requires_action >= requires_confirmation and requires_action >= requires_payment_method:
        return ("return-url",
                "%d of %d (%.0f%%) stuck, mostly at requires_action: the 3DS handoff "
                "starts and never comes back. Check next_action.type and the "
                "return_url landing page." % (stuck, total, pct))
    if requires_confirmation >= requires_payment_method:
        return ("unconfirmed",
                "%d of %d (%.0f%%) stuck, mostly at requires_confirmation: "
                "confirmSetup() is never being called for these."
                % (stuck, total, pct))
    return ("no-payment-method",
            "%d of %d (%.0f%%) stuck at requires_payment_method, above the "
            "abandonment threshold: read last_setup_error.code before blaming "
            "the customers." % (stuck, total, pct))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def page_all(session, path, limit, **params):
    """Yield objects from a paginated list endpoint until `limit` is reached."""
    seen = 0
    while True:
        page = get(session, path, **params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            return
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-intents", type=int, default=2000,
                    help="stop paginating after this many SetupIntents")
    ap.add_argument("--min-age-hours", type=float, default=MIN_AGE_HOURS,
                    help="ignore SetupIntents younger than this")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    cutoff = int(time.time() - args.min_age_hours * 3600)
    buckets = dict.fromkeys(STUCK_STATUSES, 0)
    errors = {}
    next_actions = {}
    total = 0
    params = {"limit": 100, "created[lt]": cutoff}
    for si in page_all(s, "/setup_intents", args.max_intents, **params):
        total += 1
        status = si.get("status")
        if status not in buckets:
            continue
        buckets[status] += 1
        err = (si.get("last_setup_error") or {}).get("code")
        if err:
            errors[err] = errors.get(err, 0) + 1
        action = (si.get("next_action") or {}).get("type")
        if action:
            next_actions[action] = next_actions.get(action, 0) + 1

    state, detail = verdict(total, buckets["requires_payment_method"],
                            buckets["requires_confirmation"],
                            buckets["requires_action"])
    line = "%-18s %s" % (state, detail)
    if state == "clear":
        log.info(line)
        return 0

    log.warning(line)
    for status in STUCK_STATUSES:
        log.warning("  %-24s %d", status, buckets[status])
    for code, count in sorted(errors.items(), key=lambda kv: -kv[1]):
        log.warning("  last_setup_error %-20s %d", code, count)
    for action, count in sorted(next_actions.items(), key=lambda kv: -kv[1]):
        log.warning("  next_action %-25s %d", action, count)
    log.warning("  confirm on the client and treat only 'succeeded' as success:")
    log.warning("  await stripe.confirmSetup({elements, confirmParams: {return_url}})")
    log.warning("  persist from the setup_intent.succeeded webhook, not the browser")
    log.warning("  clear the backlog: POST %s/setup_intents/{id}/cancel "
                "-d cancellation_reason=abandoned", API)
    return 1


if __name__ == "__main__":
    sys.exit(main())
