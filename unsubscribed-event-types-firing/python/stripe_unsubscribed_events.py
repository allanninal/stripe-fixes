"""Report Stripe event types that fire but reach no webhook endpoint.

Read only. Two GETs, no writes: give this a RESTRICTED key with read access to
Webhook Endpoints and Events. The repair is printed, never performed, because
this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_unsubscribed_events")

API = "https://api.stripe.com/v1"


def classify(event_type, count, subscribed):
    """Classify one fired event type against the subscription union.

    Pure, so the rules can be tested without a network. `subscribed` is the union
    of enabled_events across every endpoint. Returns (state, detail).
    """
    events = set(subscribed or [])
    if count <= 0:
        return ("unseen", "%s did not fire in the retained window" % event_type)
    if "*" in events:
        return ("wildcard",
                "%s is delivered by a wildcard subscription, along with every "
                "other type the account generates." % event_type)
    if event_type in events:
        return ("covered", "%s is subscribed on at least one endpoint" % event_type)

    namespace = event_type.split(".")[0]
    siblings = sorted(e for e in events if e.split(".")[0] == namespace)
    if siblings:
        return ("near-miss",
                "%s fired %d time(s) and is not subscribed, though %s is. "
                "enabled_events matches type names exactly: only the literal * "
                "is a wildcard, so a namespace is never covered by a sibling."
                % (event_type, count, siblings[0]))
    return ("missed",
            "%s fired %d time(s) and reached no endpoint. Nothing in the %s "
            "namespace is subscribed anywhere on this account."
            % (event_type, count, namespace))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def subscribed_union(session):
    """Every event type any endpoint on this account asks for."""
    union = set()
    for ep in get(session, "/webhook_endpoints", limit=100).get("data", []):
        union.update(ep.get("enabled_events") or [])
    return union


def fired_counts(session, limit):
    """Distinct event types seen in the retained window, with counts."""
    counts = {}
    total = 0
    params = {"limit": 100}
    while True:
        page = get(session, "/events", **params)
        data = page.get("data", [])
        for ev in data:
            total += 1
            counts[ev.get("type")] = counts.get(ev.get("type"), 0) + 1
        if not data or not page.get("has_more") or total >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=2000,
                    help="stop sampling after this many events")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    union = subscribed_union(s)
    if not union:
        log.warning("no endpoint subscribes to anything in this mode: "
                    "every event below is undelivered")

    counts = fired_counts(s, args.max_events)
    log.info("sampled %d event(s) across %d distinct type(s), %d subscribed type(s)",
             sum(counts.values()), len(counts), len(union))

    gaps = 0
    for event_type, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        state, detail = classify(event_type, count, union)
        if state in ("covered", "wildcard", "unseen"):
            continue
        gaps += 1
        log.warning("%-9s %s", state, detail)

    if gaps:
        log.warning("repair: add the types your handler branches on to an existing "
                    "endpoint's enabled_events[] at %s/webhook_endpoints/{id}. "
                    "Adding * instead trades this for a flooded handler", API)
    log.info("%d type(s) fired, %d unsubscribed", len(counts), gaps)
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
