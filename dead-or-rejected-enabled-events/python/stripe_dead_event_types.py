"""Report Stripe webhook subscriptions to event types that are dead or rejected.

Read only. Two GETs and no writes: give this a RESTRICTED key with read access
to Webhook Endpoints and Events. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_dead_event_types")

API = "https://api.stripe.com/v1"

# The Sources API families. These stay configurable but stop occurring once the
# integration moves to PaymentIntents and PaymentMethods.
LEGACY_PREFIXES = ("source.", "customer.source.")

# Types the API no longer accepts on an update, so one of these poisons every
# future change to the endpoint. Keep in step with the enabled_events enum in
# the create-endpoint reference; this is the short list seen in the wild.
REJECTED = frozenset({"invoiceitem.updated"})


def verdict(event_type, fired):
    """Classify one subscribed event type. Pure, so the rules can be tested.

    `fired` is the set of event types actually seen in the retained window.
    Returns (state, detail).
    """
    if event_type == "*":
        return ("wildcard",
                "subscribed to every type: there is no list here to diff")
    seen = set(fired or [])
    if event_type in REJECTED:
        return ("rejected",
                "the API no longer accepts this type. The next update to this "
                "endpoint fails on it, whatever the update was for.")
    if event_type.startswith(LEGACY_PREFIXES):
        if event_type in seen:
            return ("legacy",
                    "a Sources API type that is still firing: something in the "
                    "integration still creates Sources")
        return ("dead",
                "a Sources API type with no occurrences in the retained window. "
                "It does not fire for a PaymentMethod integration, so any "
                "handler branch behind it is dead code.")
    if event_type in seen:
        return ("live", "seen firing in the retained window")
    return ("quiet",
            "no occurrences in the retained window. That is low volume, not "
            "proof of decay: disputes and failures are supposed to be rare.")


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def fired_types(session, limit):
    """The set of event types seen in the retained window."""
    seen = set()
    total = 0
    params = {"limit": 100}
    while True:
        page = get(session, "/events", **params)
        data = page.get("data", [])
        for ev in data:
            total += 1
            seen.add(ev.get("type"))
        if not data or not page.get("has_more") or total >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return seen, total


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=5000,
                    help="stop sampling event types after this many events")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    eps = get(s, "/webhook_endpoints", limit=100).get("data", [])
    if not eps:
        log.info("no webhook endpoints configured for this key's mode")
        return 0

    seen, total = fired_types(s, args.max_events)
    log.info("sampled %d event(s) across %d distinct type(s)", total, len(seen))

    bad = 0
    for ep in eps:
        keep = []
        drop = []
        for t in ep.get("enabled_events") or []:
            state, detail = verdict(t, seen)
            line = "%-9s %-32s %s" % (state, t, detail)
            if state in ("dead", "rejected"):
                bad += 1
                drop.append(t)
                log.warning("%s  %s", ep.get("url", "?"), line)
            else:
                keep.append(t)
                log.info("%s  %s", ep.get("url", "?"), line)
        if drop:
            log.warning("  enabled_events is replaced wholesale on update, so "
                        "re-send the full corrected list:")
            log.warning("  repair: POST %s/webhook_endpoints/%s %s",
                        API, ep["id"],
                        " ".join("-d enabled_events[]=%s" % t for t in keep[:6])
                        + (" ..." if len(keep) > 6 else ""))
            log.warning("  dropping: %s", ", ".join(drop))

    log.info("%d endpoint(s), %d dead or rejected subscription(s)", len(eps), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
