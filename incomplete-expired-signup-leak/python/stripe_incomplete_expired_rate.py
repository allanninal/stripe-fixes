"""Measure Stripe incomplete_expired subscriptions against activations.

Read only. Two paginated GETs, no writes: give this a RESTRICTED key with read
access to Subscriptions. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_incomplete_expired_rate")

API = "https://api.stripe.com/v1"

# Share of activations above which the confirmation step is failing for part of
# the traffic rather than being abandoned by part of the customers.
LEAKING = 0.10
# Above this, it is not a slice of traffic any more.
BROKEN = 0.50


def verdict(expired, active, days=30, leaking=LEAKING, broken=BROKEN):
    """Judge one window of signups by the share that never confirmed. Pure.

    Takes two counts rather than one subscription, because the finding is a
    ratio: 200 expired subscriptions is background noise against 4,000
    activations and an outage against 300, and no single row can tell you which.

    Returns (state, detail).
    """
    if expired < 0 or active < 0:
        return ("unknown", "negative counts, so the ratio means nothing")

    if expired == 0 and active == 0:
        return ("no-signups",
                "no subscriptions created in the last %d day(s), so there is "
                "nothing to measure" % days)

    if expired == 0:
        return ("clean",
                "%d activation(s) in %d day(s) and nothing expired unconfirmed"
                % (active, days))

    if active == 0:
        return ("broken",
                "%d subscription(s) expired unconfirmed and not one activated in "
                "%d day(s): nothing is confirming at all" % (expired, days))

    ratio = expired / active
    pct = 100.0 * ratio

    if ratio >= broken:
        return ("broken",
                "%d expired against %d activation(s), %.1f%%: the confirmation "
                "step is failing for most of the traffic" % (expired, active, pct))

    if ratio >= leaking:
        return ("leaking",
                "%d expired against %d activation(s), %.1f%%: a slice of the "
                "traffic cannot complete the confirmation" % (expired, active, pct))

    return ("background",
            "%d expired against %d activation(s), %.1f%%: ordinary abandonment"
            % (expired, active, pct))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def count(session, status, since, limit):
    """Page a status to the end. One page of each and a division is a wrong answer."""
    total = 0
    params = {"status": status, "limit": 100, "created[gte]": since}
    while True:
        page = get(session, "/subscriptions", **params)
        rows = page.get("data", [])
        total += len(rows)
        if not page.get("has_more") or not rows or total >= limit:
            break
        params["starting_after"] = rows[-1]["id"]
    return total


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="window to measure, in days (default 30)")
    ap.add_argument("--max-rows", type=int, default=5000,
                    help="stop paginating each status after this many rows")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = int(time.time()) - args.days * 86400
    expired = count(s, "incomplete_expired", since, args.max_rows)
    active = count(s, "active", since, args.max_rows)

    state, detail = verdict(expired, active, args.days)
    if state in ("clean", "background", "no-signups"):
        log.info("%s: %s", state, detail)
        return 0

    log.warning("%s: %s", state, detail)
    log.warning("repair: create with payment_behavior=default_incomplete, expand "
                "latest_invoice.confirmation_secret, and confirm it client side "
                "in the same session")
    log.warning("repair: handle invoice.payment_action_required so an unfinished "
                "signup gets an email rather than a countdown")
    log.warning("note: expired subscriptions are terminal. The invoice is void "
                "and no API call revives them; these customers need a new signup.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
