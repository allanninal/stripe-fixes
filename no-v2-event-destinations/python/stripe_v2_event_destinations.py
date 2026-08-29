"""Report a Stripe account with no v2 event destination for thin events.

Read only. Two GETs and no writes: give this a RESTRICTED key with read access to
Event Destinations and Billing Meters. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_v2_event_destinations")

API_V1 = "https://api.stripe.com/v1"
API_V2 = "https://api.stripe.com/v2"

# Sent explicitly. The account default may predate v2 entirely, in which case the
# v2 path errors instead of returning an empty list, and the two look nothing
# alike once you know to tell them apart.
DEFAULT_VERSION = "2025-03-31.basil"


def verdict(destinations, v2_feature_in_use=False):
    """Classify an account's v2 event destinations. Pure, so it is testable offline.

    `destinations` is the list from /v2/core/event_destinations. `v2_feature_in_use`
    says whether anything on the account is currently generating thin events, which
    is what separates a gap from an outage. Returns (state, detail).
    """
    dests = list(destinations or [])
    thin = [d for d in dests if d.get("event_payload") == "thin"]
    enabled = [d for d in thin if d.get("status") == "enabled"]
    if enabled:
        return ("covered",
                "%s is enabled and takes thin events"
                % enabled[0].get("id", "<no id>"))
    if thin:
        d = thin[0]
        return ("disabled",
                "%s takes thin events but its status is %r: %s"
                % (d.get("id", "<no id>"), d.get("status"),
                   d.get("status_details") or "no status_details given"))
    if dests:
        return ("snapshot-only",
                "%d event destination(s) exist and every one of them is "
                "event_payload=snapshot, which cannot carry a thin event"
                % len(dests))
    if v2_feature_in_use:
        return ("dropping",
                "no v2 event destination at all, and a v2 feature is in use: the "
                "thin events it emits are being generated and delivered nowhere")
    return ("none",
            "no v2 event destination exists. Nothing emits thin events yet, so "
            "nothing is being lost today.")


def get(session, url, params=None, version=None):
    headers = {"Stripe-Version": version} if version else {}
    r = session.get(url, params=params or {}, headers=headers, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    if r.status_code in (400, 404) and "/v2/" in url:
        raise SystemExit(
            "%d from %s: this key or API version cannot see v2 resources. Retry "
            "with --api-version set to a version that supports v2." % (r.status_code, url))
    r.raise_for_status()
    return r.json()


def event_destinations(session, version):
    """Every v2 event destination.

    The v2 list endpoints paginate with an absolute `next_page_url` rather than the
    `starting_after` cursor the v1 list endpoints use, so the loop follows the URL
    Stripe hands back instead of building one.
    """
    out = []
    url = API_V2 + "/core/event_destinations"
    params = {"limit": 100}
    while url:
        page = get(session, url, params, version)
        out.extend(page.get("data", []))
        url = page.get("next_page_url")
        params = None
    return out


def v2_feature_in_use(session):
    """One cheap probe: does anything on this account emit thin events yet?

    Billing meters are the most common entry point. A different v2 feature would
    need its own probe; the point of the flag is only to separate a gap that costs
    nothing today from one that is losing events right now.
    """
    page = get(session, API_V1 + "/billing/meters", {"limit": 1})
    return bool(page.get("data"))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--api-version", default=DEFAULT_VERSION,
                    help="Stripe-Version to send on the v2 request")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    s = requests.Session()
    s.headers.update({"Authorization": "Bearer " + key})

    dests = event_destinations(s, args.api_version)
    in_use = v2_feature_in_use(s)
    state, detail = verdict(dests, in_use)

    log.info("%-16s %s", state, detail)
    for d in dests:
        log.info("  %s  payload=%s  status=%s  events_from=%s",
                 d.get("id"), d.get("event_payload"), d.get("status"),
                 d.get("events_from"))
    if state == "covered":
        return 0

    if state == "disabled":
        log.warning("  repair: fix the handler, then re-enable the destination at "
                    "%s/core/event_destinations/<id>/enable", API_V2)
        return 1

    log.warning("  repair: create a thin destination (a separate object from any "
                "/v1/webhook_endpoints you already have):")
    log.warning("  POST %s/core/event_destinations -d type=webhook_endpoint "
                "-d event_payload=thin -d \"events_from[]=@self\" "
                "-d \"enabled_events[]=v1.billing.meter.error_report_triggered\" "
                "-d webhook_endpoint[url]=https://<yourdomain>/stripe/thin-webhook "
                "-d \"include[]=webhook_endpoint.signing_secret\"", API_V2)
    log.warning("  the signing secret is returned once, on create, and only if you "
                "ask for it with include[]")
    return 1


if __name__ == "__main__":
    sys.exit(main())
