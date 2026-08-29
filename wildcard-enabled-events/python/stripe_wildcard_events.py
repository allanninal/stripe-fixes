"""Report Stripe webhook endpoints subscribed to far more events than they handle.

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
log = logging.getLogger("stripe_wildcard_events")

API = "https://api.stripe.com/v1"

# Above this an explicit list is a wildcard somebody typed out by hand.
WIDE = 40


def verdict(enabled_events, fired_types):
    """Classify one endpoint's subscription. Pure, so the rules can be tested.

    `enabled_events` is the endpoint's array; `fired_types` is the set of event
    types actually seen in the retained window. Returns (state, detail).
    """
    events = list(enabled_events or [])
    if not events:
        return ("empty", "no enabled_events at all: this endpoint receives nothing")
    if "*" in events:
        return ("wildcard",
                "subscribed to every event type. %d distinct type(s) fired in the "
                "retained window, and all of them are being delivered."
                % len(set(fired_types or [])))
    if len(events) > WIDE:
        return ("overbroad",
                "%d explicit types subscribed. That is a wildcard written out by "
                "hand and carries the same load." % len(events))
    unused = sorted(e for e in set(events) if e not in set(fired_types or []))
    if unused:
        return ("padded",
                "%d of %d subscribed type(s) never fired in the retained window: %s"
                % (len(unused), len(set(events)), ", ".join(unused[:5])))
    return ("focused", "%d type(s), all seen firing" % len(set(events)))


def get(session, path, **params):
    r = session.get(API + path, params=params, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def fired_types(session, limit):
    """Distinct event types seen in the retained window, with counts."""
    counts = {}
    total = 0
    params = {"limit": 100}
    while True:
        page = get(session, "/events", **params)
        data = page.get("data", [])
        for ev in data:
            total += 1
            t = ev.get("type")
            counts[t] = counts.get(t, 0) + 1
        if not data or not page.get("has_more") or total >= limit:
            break
        params["starting_after"] = data[-1]["id"]
    return counts


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-events", type=int, default=2000,
                    help="stop sampling event types after this many events")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    endpoints = get(s, "/webhook_endpoints", limit=100).get("data", [])
    if not endpoints:
        log.info("no webhook endpoints configured for this key's mode")
        return 0

    counts = fired_types(s, args.max_events)
    log.info("sampled %d event(s) across %d distinct type(s)",
             sum(counts.values()), len(counts))

    bad = 0
    for ep in endpoints:
        state, detail = verdict(ep.get("enabled_events"), counts.keys())
        line = "%-10s %s  %s" % (state, ep.get("url", "?"), detail)
        if state == "focused":
            log.info(line)
            continue
        bad += 1
        log.warning(line)
        if state in ("wildcard", "overbroad", "padded"):
            top = sorted(counts.items(), key=lambda kv: -kv[1])[:8]
            log.warning("  busiest types seen: %s",
                        ", ".join("%s x%d" % (t, n) for t, n in top))
            log.warning("  repair: POST %s/webhook_endpoints/%s "
                        "-d enabled_events[]=<type> ... (one per branch in your handler)",
                        API, ep["id"])

    log.info("%d endpoint(s), %d needing attention", len(endpoints), bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
