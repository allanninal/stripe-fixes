"""Report Stripe API requests made without an Idempotency-Key.

Read only. One paginated GET and no writes: give this a RESTRICTED key with
read access to Events. The repair is printed, never performed, because this
script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_idempotency_keys")

API = "https://api.stripe.com/v1"

# A duplicate of any of these costs real money or real support time.
MONEY_MOVING = ("payment_intent.created", "charge.succeeded", "refund.created")
WATCHED = MONEY_MOVING + ("customer.created",)


def classify(request):
    """What one event's `request` field says about the call that caused it.

    Pure. Returns one of:
      "stripe"     no request id at all: Stripe did this on your behalf, and
                   there was never a key to send. Not a finding.
      "unreported" a bare string request id, which is how very old API versions
                   rendered this field. The key is unknown, not absent.
      "keyed"      an API request that carried an Idempotency-Key.
      "unkeyed"    an API request that did not. This is the finding.
    """
    if request is None:
        return "stripe"
    if isinstance(request, str):
        return "unreported" if request else "stripe"
    if not request.get("id"):
        return "stripe"
    return "keyed" if request.get("idempotency_key") else "unkeyed"


def verdict(event_type, api_requests, unkeyed):
    """Classify one event type's tally. Pure, so the thresholds can be tested."""
    if not api_requests:
        return ("stripe-only",
                "no API-originated events in the window: nothing here is yours "
                "to key")
    if not unkeyed:
        return ("keyed",
                "%d API request(s), all carrying a key" % api_requests)
    pct = 100.0 * unkeyed / api_requests
    if event_type in MONEY_MOVING:
        return ("exposed",
                "%d of %d API request(s) sent no key (%.1f%%). A retried timeout "
                "on any of these charges the customer twice."
                % (unkeyed, api_requests, pct))
    return ("unkeyed",
            "%d of %d API request(s) sent no key (%.1f%%). Retries create "
            "duplicate records rather than duplicate charges."
            % (unkeyed, api_requests, pct))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def tally(session, since, limit):
    """Per-type counts of API-originated events and how many carried no key."""
    counts = {t: {"api": 0, "unkeyed": 0, "unreported": 0} for t in WATCHED}
    total = 0
    params = {"limit": 100, "created[gte]": int(since)}
    for i, t in enumerate(WATCHED):
        params["types[%d]" % i] = t
    while True:
        page = get(session, "/events", **params)
        data = page.get("data", [])
        for ev in data:
            total += 1
            row = counts.get(ev.get("type"))
            if row is None:
                continue
            state = classify(ev.get("request"))
            if state == "stripe":
                continue
            if state == "unreported":
                row["unreported"] += 1
                continue
            row["api"] += 1
            if state == "unkeyed":
                row["unkeyed"] += 1
        if not data or not page.get("has_more") or total >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return counts, total


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="how far back to sample, up to the 30-day retention limit")
    ap.add_argument("--max-events", type=int, default=5000,
                    help="stop paginating after this many events")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    since = time.time() - args.days * 86400
    counts, total = tally(s, since, args.max_events)
    log.info("sampled %d event(s) over %d day(s)", total, args.days)

    bad = 0
    for t in WATCHED:
        row = counts[t]
        state, detail = verdict(t, row["api"], row["unkeyed"])
        line = "%-11s %-24s %s" % (state, t, detail)
        if state in ("keyed", "stripe-only"):
            log.info(line)
        else:
            bad += 1
            log.warning(line)
        if row["unreported"]:
            log.info("  %d event(s) rendered at an API version that does not "
                     "report the key; upgrade the endpoint pin to judge them",
                     row["unreported"])

    if bad:
        log.warning("  repair: send an Idempotency-Key header on every mutating "
                    "request, in the options argument rather than the params:")
        log.warning("  node:   stripe.paymentIntents.create(params, { idempotencyKey })")
        log.warning("  python: stripe.PaymentIntent.create(..., idempotency_key=key)")
        log.warning("  php:    $stripe->paymentIntents->create($params, "
                    "['idempotency_key' => $key])")
        log.warning("  the key is a v4 uuid per logical operation, persisted with "
                    "the order and reused unchanged for every retry of it")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
