"""Report Stripe Payment Links whose completed payments fulfil nothing.

Read only. Two GETs and no writes: give this a RESTRICTED key with read access to
Payment Links and Webhook Endpoints. The repair is printed, never performed,
because this script holds a credential to a live payments account.
"""
import argparse
import logging
import os
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("stripe_payment_link_fulfilment")

API = "https://api.stripe.com/v1"

COMPLETED_EVENT = "checkout.session.completed"
PLACEHOLDER = "{CHECKOUT_SESSION_ID}"


def listens_for_completion(endpoints):
    """True when some enabled endpoint would receive checkout.session.completed.

    Pure. A disabled endpoint receives nothing, and a wildcard subscription does
    receive this event even though it receives a great deal else besides.
    """
    for ep in endpoints or []:
        if ep.get("status") != "enabled":
            continue
        events = ep.get("enabled_events") or []
        if COMPLETED_EVENT in events or "*" in events:
            return True
    return False


def verdict(link, webhook_covered):
    """Classify one Payment Link. Pure, so the rules can be tested offline.

    `webhook_covered` is the account-wide fact from listens_for_completion(): the
    same link configuration means different things with and without it.
    Returns (state, detail).
    """
    after = link.get("after_completion") or {}
    kind = after.get("type") or "hosted_confirmation"

    if kind == "redirect":
        url = str((after.get("redirect") or {}).get("url") or "")
        if PLACEHOLDER not in url:
            return ("blind-redirect",
                    "redirects to %s with no %s, so the landing page cannot tell "
                    "which purchase it is confirming"
                    % (url or "an empty url", PLACEHOLDER))
        if not webhook_covered:
            return ("landing-only",
                    "the redirect is the only fulfilment trigger, and it fires "
                    "only if the customer's browser reaches your page")
        return ("covered", "redirects with the session id, and the event is subscribed")

    if kind == "hosted_confirmation":
        if webhook_covered:
            return ("webhook-only",
                    "the flow ends on Stripe's page, so fulfilment runs from "
                    "%s alone; the buyer never lands anywhere of yours"
                    % COMPLETED_EVENT)
        return ("unfulfilled",
                "the flow ends on Stripe's page and no enabled endpoint listens "
                "for %s: nothing fulfils these payments at all" % COMPLETED_EVENT)

    return ("unknown", "unrecognised after_completion.type %r" % (kind,))


def get(http, path, params=None):
    r = http.get(API + path, params=params or {}, timeout=30)
    if r.status_code == 401:
        raise SystemExit("401 from Stripe: the key is wrong, or is for the other mode")
    r.raise_for_status()
    return r.json()


def all_pages(http, path, limit):
    """Yield every object from a paginated list endpoint."""
    seen = 0
    params = {"limit": 100}
    while True:
        page = get(http, path, params)
        data = page.get("data", [])
        for obj in data:
            yield obj
            seen += 1
        if not data or not page.get("has_more") or seen >= limit:
            break
        params["starting_after"] = data[-1]["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-links", type=int, default=1000,
                    help="stop paginating after this many payment links")
    ap.add_argument("--show", type=int, default=20,
                    help="how many failing links to print")
    args = ap.parse_args()

    key = os.environ.get("STRIPE_API_KEY")
    if not key:
        log.error("set STRIPE_API_KEY (use a restricted, read-only key)")
        return 2

    http = requests.Session()
    http.headers.update({"Authorization": "Bearer " + key})

    endpoints = get(http, "/webhook_endpoints", {"limit": 100}).get("data", [])
    covered = listens_for_completion(endpoints)
    if not covered:
        log.warning("no enabled webhook endpoint listens for %s in this key's mode",
                    COMPLETED_EVENT)

    tally = {"covered": 0, "webhook-only": 0, "landing-only": 0,
             "blind-redirect": 0, "unfulfilled": 0, "unknown": 0}
    examples = []
    links = 0
    for link in all_pages(http, "/payment_links", args.max_links):
        links += 1
        state, detail = verdict(link, covered)
        tally[state] = tally.get(state, 0) + 1
        if state in ("unfulfilled", "landing-only", "blind-redirect") \
                and len(examples) < args.show:
            examples.append((state, link.get("id", "?"), detail))

    log.info("%d link(s): %d covered, %d webhook-only, %d landing-only, "
             "%d blind-redirect, %d unfulfilled",
             links, tally["covered"], tally["webhook-only"], tally["landing-only"],
             tally["blind-redirect"], tally["unfulfilled"])
    for state, lid, detail in examples:
        log.warning("%-14s %s  %s", state, lid, detail)

    if tally["unfulfilled"] or tally["blind-redirect"]:
        log.warning("  repair: POST %s/payment_links/plink_XXX "
                    "-d 'after_completion[type]=redirect' "
                    "-d 'after_completion[redirect][url]="
                    "https://example.com/after-checkout?session_id=%s'",
                    API, PLACEHOLDER)
    if not covered:
        log.warning("  and subscribe an enabled endpoint to %s plus "
                    "checkout.session.async_payment_succeeded", COMPLETED_EVENT)
        log.warning("  check which links are actually in use: GET "
                    "%s/checkout/sessions?payment_link=plink_XXX", API)

    return 1 if (tally["unfulfilled"] or tally["landing-only"]
                 or tally["blind-redirect"]) else 0


if __name__ == "__main__":
    sys.exit(main())
